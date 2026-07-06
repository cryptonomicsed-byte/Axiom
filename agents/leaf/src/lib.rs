//! AXIOM leaf agent — a real sandboxed agent process compiled to WebAssembly.
//!
//! ## ABI contract (host <-> agent)
//!
//! The host is any implementation of AXIOM's `AgentRuntimeProvider` (the
//! browser `WasmAgentHost` today; any Wasm embedder tomorrow). The contract
//! is deliberately minimal and dependency-free — no wasm-bindgen, no std
//! collections in the interface — so the same pattern works from Rust, Zig,
//! C, or anything that can export functions and share linear memory:
//!
//! - `manifest_ptr()` / `manifest_len()`: static JSON tool manifest
//!   (MCP-style: name + description per tool) the host reads at spawn to
//!   populate the agent's discoverable capabilities.
//! - `alloc(len) -> ptr`: the host asks the agent for scratch space, writes
//!   UTF-8 input there.
//! - `invoke(tool_ptr, tool_len, arg_ptr, arg_len) -> u64`: runs a tool;
//!   the u64 packs the result's (ptr << 32 | len) in agent memory. The
//!   result buffer stays valid until the next `invoke`/`alloc` call.
//!
//! Tools are deterministic on purpose: the host (and any auditor) can
//! re-verify a result independently — the seed of Zangbeto-style
//! receipt checking.

#![no_std]

use core::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

// ---------------------------------------------------------------------------
// Bump allocator over a static arena — enough for a leaf, no allocator crate.
// ---------------------------------------------------------------------------

const ARENA_SIZE: usize = 64 * 1024;
static mut ARENA: [u8; ARENA_SIZE] = [0; ARENA_SIZE];
static ARENA_NEXT: AtomicUsize = AtomicUsize::new(0);

/// Number of times this instance has been invoked — real per-agent state
/// that survives across calls and proves the process is alive.
static TICKS: AtomicU32 = AtomicU32::new(0);

fn arena_alloc(len: usize) -> *mut u8 {
    let base = core::ptr::addr_of_mut!(ARENA).cast::<u8>();
    let offset = ARENA_NEXT.fetch_add(len, Ordering::SeqCst);
    if offset + len > ARENA_SIZE {
        // Wrap: leaf calls are short-lived; older buffers are dead by now.
        ARENA_NEXT.store(len, Ordering::SeqCst);
        base
    } else {
        unsafe { base.add(offset) }
    }
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const MANIFEST: &str = r#"{"agent":"axiom-leaf","version":"0.1.0","tools":[
{"name":"echo","description":"Return the input verbatim, prefixed with this instance's tick count"},
{"name":"fnv1a","description":"FNV-1a 64-bit hash of the input, hex-encoded (deterministic, host-verifiable)"},
{"name":"stats","description":"Parse whitespace-separated numbers; return count/sum/min/max as JSON"},
{"name":"tick","description":"Increment and return this instance's private invocation counter (proves live per-agent state)"}
]}"#;

#[no_mangle]
pub extern "C" fn manifest_ptr() -> *const u8 {
    MANIFEST.as_ptr()
}

#[no_mangle]
pub extern "C" fn manifest_len() -> usize {
    MANIFEST.len()
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    arena_alloc(len)
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

/// Writes `value` as lowercase hex into `out`, returns bytes written.
fn write_hex(mut value: u64, out: &mut [u8]) -> usize {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut buf = [0u8; 16];
    let mut i = 16;
    loop {
        i -= 1;
        buf[i] = DIGITS[(value & 0xf) as usize];
        value >>= 4;
        if value == 0 {
            break;
        }
    }
    let len = 16 - i;
    out[..len].copy_from_slice(&buf[i..]);
    len
}

/// Writes `value` as decimal into `out`, returns bytes written.
fn write_dec(value: i64, out: &mut [u8]) -> usize {
    if value == 0 {
        out[0] = b'0';
        return 1;
    }
    let negative = value < 0;
    let mut v = if negative { (-value) as u64 } else { value as u64 };
    let mut buf = [0u8; 20];
    let mut i = 20;
    while v > 0 {
        i -= 1;
        buf[i] = b'0' + (v % 10) as u8;
        v /= 10;
    }
    let mut len = 0;
    if negative {
        out[0] = b'-';
        len = 1;
    }
    let digits = 20 - i;
    out[len..len + digits].copy_from_slice(&buf[i..]);
    len + digits
}

struct Out {
    ptr: *mut u8,
    len: usize,
    cap: usize,
}

impl Out {
    fn new(cap: usize) -> Self {
        Out { ptr: arena_alloc(cap), len: 0, cap }
    }
    fn push(&mut self, bytes: &[u8]) {
        let take = core::cmp::min(bytes.len(), self.cap - self.len);
        unsafe {
            core::ptr::copy_nonoverlapping(bytes.as_ptr(), self.ptr.add(self.len), take);
        }
        self.len += take;
    }
    fn push_dec(&mut self, value: i64) {
        let mut buf = [0u8; 21];
        let n = write_dec(value, &mut buf);
        self.push(&buf[..n]);
    }
    fn packed(&self) -> u64 {
        ((self.ptr as u64) << 32) | self.len as u64
    }
}

fn tool_echo(arg: &[u8]) -> Out {
    let ticks = TICKS.fetch_add(1, Ordering::SeqCst) + 1;
    let mut out = Out::new(arg.len() + 32);
    out.push(b"[tick ");
    out.push_dec(ticks as i64);
    out.push(b"] ");
    out.push(arg);
    out
}

fn tool_fnv1a(arg: &[u8]) -> Out {
    TICKS.fetch_add(1, Ordering::SeqCst);
    let hash = fnv1a(arg);
    let mut out = Out::new(24);
    let mut buf = [0u8; 16];
    let n = write_hex(hash, &mut buf);
    out.push(b"0x");
    out.push(&buf[..n]);
    out
}

fn tool_stats(arg: &[u8]) -> Out {
    TICKS.fetch_add(1, Ordering::SeqCst);
    let mut count: i64 = 0;
    let mut sum: i64 = 0;
    let mut min = i64::MAX;
    let mut max = i64::MIN;
    let mut current: i64 = 0;
    let mut in_number = false;
    let mut negative = false;

    let mut flush = |current: &mut i64, negative: &mut bool, in_number: &mut bool| {
        if *in_number {
            let v = if *negative { -*current } else { *current };
            count += 1;
            sum += v;
            if v < min {
                min = v;
            }
            if v > max {
                max = v;
            }
        }
        *current = 0;
        *negative = false;
        *in_number = false;
    };

    for &b in arg {
        match b {
            b'0'..=b'9' => {
                current = current.wrapping_mul(10).wrapping_add((b - b'0') as i64);
                in_number = true;
            }
            b'-' if !in_number => negative = true,
            _ => flush(&mut current, &mut negative, &mut in_number),
        }
    }
    flush(&mut current, &mut negative, &mut in_number);

    let mut out = Out::new(128);
    out.push(b"{\"count\":");
    out.push_dec(count);
    out.push(b",\"sum\":");
    out.push_dec(sum);
    if count > 0 {
        out.push(b",\"min\":");
        out.push_dec(min);
        out.push(b",\"max\":");
        out.push_dec(max);
    }
    out.push(b"}");
    out
}

fn tool_tick() -> Out {
    let ticks = TICKS.fetch_add(1, Ordering::SeqCst) + 1;
    let mut out = Out::new(48);
    out.push(b"{\"ticks\":");
    out.push_dec(ticks as i64);
    out.push(b"}");
    out
}

fn tool_unknown(name: &[u8]) -> Out {
    let mut out = Out::new(name.len() + 32);
    out.push(b"error: unknown tool \"");
    out.push(name);
    out.push(b"\"");
    out
}

/// Entry point. Returns (ptr << 32 | len) of the UTF-8 result in agent memory.
#[no_mangle]
pub extern "C" fn invoke(
    tool_ptr: *const u8,
    tool_len: usize,
    arg_ptr: *const u8,
    arg_len: usize,
) -> u64 {
    let tool = unsafe { core::slice::from_raw_parts(tool_ptr, tool_len) };
    let arg = unsafe { core::slice::from_raw_parts(arg_ptr, arg_len) };
    let out = match tool {
        b"echo" => tool_echo(arg),
        b"fnv1a" => tool_fnv1a(arg),
        b"stats" => tool_stats(arg),
        b"tick" => tool_tick(),
        other => tool_unknown(other),
    };
    out.packed()
}
