//! AXIOM Fractal Oracle — a real sandboxed agent that computes Mandelbrot
//! dynamics, compiled to WebAssembly.
//!
//! The iteration `z_{n+1} = z_n² + c` (escape when |z| > 2) is the primitive:
//! a point `c` whose orbit stays bounded is a **robust island** (a stable,
//! low-fragility attractor); a point that escapes quickly is an **escape zone**
//! (brittle — blows up under a regime shift); points that escape late sit on the
//! **fragile boundary**. That maps directly onto strategy-parameter robustness,
//! market-structure persistence, and swarm stability.
//!
//! Same host↔agent ABI as `agents/leaf` (manifest_ptr/len, alloc, invoke) so it
//! plugs into the existing `WasmAgentHost` unchanged. Everything is deterministic
//! and dependency-free: the host (or an auditor) can re-verify any result.

#![no_std]

use core::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

// ── Bump allocator over a static arena (no allocator crate) ────────────────
const ARENA_SIZE: usize = 256 * 1024; // larger than the leaf: scan grids are big
static mut ARENA: [u8; ARENA_SIZE] = [0; ARENA_SIZE];
static ARENA_NEXT: AtomicUsize = AtomicUsize::new(0);

/// Scans performed by this instance — real per-agent state proving it's live.
static SCANS: AtomicU32 = AtomicU32::new(0);
/// Robust (bounded) points this instance has found — drives the node's glow.
static ISLANDS: AtomicU32 = AtomicU32::new(0);

fn arena_alloc(len: usize) -> *mut u8 {
    let base = core::ptr::addr_of_mut!(ARENA).cast::<u8>();
    let offset = ARENA_NEXT.fetch_add(len, Ordering::SeqCst);
    if offset + len > ARENA_SIZE {
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

// ── Manifest (MCP-style) ───────────────────────────────────────────────────
const MANIFEST: &str = r#"{"agent":"axiom-oracle","version":"0.1.0","tools":[
{"name":"mandelbrot_scan","description":"Escape-time grid over a region. Arg: re0,re1,im0,im1,width,height[,maxiter] → JSON {w,h,maxiter,esc:[...]} row-major"},
{"name":"escape_time_risk","description":"Fragility of a single point c. Arg: re,im[,maxiter] → JSON {escape,bounded,stability,risk,verdict}"},
{"name":"robust_island_query","description":"Is c a robust island? Arg: re,im[,maxiter] → JSON {bounded,depth,stability,island}"},
{"name":"fractal_signal_filter","description":"Classify a series as bounded (accumulation) vs divergent (breakout). Arg: numbers (pairs=re,im) → JSON {points,bounded,bounded_fraction,signal}"},
{"name":"swarm_stability_map","description":"Stability of a swarm mapped into parameter space. Arg: numbers (pairs=re,im) → JSON {agents,bounded,stability,verdict}"}
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

// ── Output buffer ───────────────────────────────────────────────────────────
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
        unsafe { core::ptr::copy_nonoverlapping(bytes.as_ptr(), self.ptr.add(self.len), take) };
        self.len += take;
    }
    fn push_dec(&mut self, value: i64) {
        let mut buf = [0u8; 21];
        let n = write_dec(value, &mut buf);
        self.push(&buf[..n]);
    }
    /// Fixed-point float with 4 decimals (deterministic, allocation-free).
    fn push_f64(&mut self, mut v: f64) {
        if v.is_nan() {
            self.push(b"0");
            return;
        }
        if v < 0.0 {
            self.push(b"-");
            v = -v;
        }
        let scaled = (v * 10000.0 + 0.5) as i64; // round to 4 dp
        self.push_dec(scaled / 10000);
        self.push(b".");
        let mut frac = scaled % 10000;
        let mut d = [b'0'; 4];
        let mut i = 4;
        while i > 0 {
            i -= 1;
            d[i] = b'0' + (frac % 10) as u8;
            frac /= 10;
        }
        self.push(&d);
    }
    fn packed(&self) -> u64 {
        ((self.ptr as u64) << 32) | self.len as u64
    }
}

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

// ── Number parsing (comma/whitespace separated f64 tokens) ─────────────────
struct Scanner<'a> {
    bytes: &'a [u8],
    pos: usize,
}
impl<'a> Scanner<'a> {
    fn new(b: &'a [u8]) -> Self {
        Scanner { bytes: b, pos: 0 }
    }
    fn is_sep(b: u8) -> bool {
        matches!(b, b',' | b' ' | b'\t' | b'\n' | b'\r' | b';')
    }
    fn next_f64(&mut self) -> Option<f64> {
        while self.pos < self.bytes.len() && Self::is_sep(self.bytes[self.pos]) {
            self.pos += 1;
        }
        if self.pos >= self.bytes.len() {
            return None;
        }
        let mut neg = false;
        if self.bytes[self.pos] == b'-' {
            neg = true;
            self.pos += 1;
        } else if self.bytes[self.pos] == b'+' {
            self.pos += 1;
        }
        let mut int_part: f64 = 0.0;
        let mut any = false;
        while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_digit() {
            int_part = int_part * 10.0 + (self.bytes[self.pos] - b'0') as f64;
            self.pos += 1;
            any = true;
        }
        let mut frac: f64 = 0.0;
        if self.pos < self.bytes.len() && self.bytes[self.pos] == b'.' {
            self.pos += 1;
            let mut scale = 0.1;
            while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_digit() {
                frac += (self.bytes[self.pos] - b'0') as f64 * scale;
                scale *= 0.1;
                self.pos += 1;
                any = true;
            }
        }
        if !any {
            return None;
        }
        let v = int_part + frac;
        Some(if neg { -v } else { v })
    }
    fn next_i64(&mut self, default: i64) -> i64 {
        self.next_f64().map(|v| v as i64).unwrap_or(default)
    }
}

// ── Mandelbrot core ─────────────────────────────────────────────────────────
/// Iterations before |z|>2, or `maxiter` if the orbit stays bounded.
fn escape_time(cr: f64, ci: f64, maxiter: u32) -> u32 {
    let mut zr = 0.0f64;
    let mut zi = 0.0f64;
    let mut i = 0u32;
    while i < maxiter {
        let zr2 = zr * zr;
        let zi2 = zi * zi;
        if zr2 + zi2 > 4.0 {
            return i;
        }
        zi = 2.0 * zr * zi + ci;
        zr = zr2 - zi2 + cr;
        i += 1;
    }
    maxiter
}

fn clamp_iter(m: i64) -> u32 {
    if m < 8 {
        8
    } else if m > 2000 {
        2000
    } else {
        m as u32
    }
}

// ── Tools ───────────────────────────────────────────────────────────────────
fn tool_scan(arg: &[u8]) -> Out {
    SCANS.fetch_add(1, Ordering::SeqCst);
    let mut s = Scanner::new(arg);
    let re0 = s.next_f64().unwrap_or(-2.5);
    let re1 = s.next_f64().unwrap_or(1.0);
    let im0 = s.next_f64().unwrap_or(-1.25);
    let im1 = s.next_f64().unwrap_or(1.25);
    let mut w = s.next_i64(96);
    let mut h = s.next_i64(64);
    let maxiter = clamp_iter(s.next_i64(120));
    if w < 1 {
        w = 1;
    }
    if w > 220 {
        w = 220;
    }
    if h < 1 {
        h = 1;
    }
    if h > 160 {
        h = 160;
    }
    let mut out = Out::new((w * h * 5 + 128) as usize);
    out.push(b"{\"w\":");
    out.push_dec(w);
    out.push(b",\"h\":");
    out.push_dec(h);
    out.push(b",\"maxiter\":");
    out.push_dec(maxiter as i64);
    out.push(b",\"esc\":[");
    let mut islands: u32 = 0;
    for yy in 0..h {
        let ci = im0 + (im1 - im0) * (yy as f64) / ((h - 1).max(1) as f64);
        for xx in 0..w {
            let cr = re0 + (re1 - re0) * (xx as f64) / ((w - 1).max(1) as f64);
            let e = escape_time(cr, ci, maxiter);
            if e >= maxiter {
                islands += 1;
            }
            if !(yy == 0 && xx == 0) {
                out.push(b",");
            }
            out.push_dec(e as i64);
        }
    }
    ISLANDS.fetch_add(islands, Ordering::SeqCst);
    out.push(b"]}");
    out
}

/// Shared verdict for a single point.
fn classify(cr: f64, ci: f64, maxiter: u32) -> (u32, bool, f64) {
    let e = escape_time(cr, ci, maxiter);
    let bounded = e >= maxiter;
    let stability = (e as f64) / (maxiter as f64); // 1.0 = fully bounded
    (e, bounded, stability)
}

fn tool_escape_risk(arg: &[u8]) -> Out {
    SCANS.fetch_add(1, Ordering::SeqCst);
    let mut s = Scanner::new(arg);
    let cr = s.next_f64().unwrap_or(0.0);
    let ci = s.next_f64().unwrap_or(0.0);
    let maxiter = clamp_iter(s.next_i64(200));
    let (e, bounded, stability) = classify(cr, ci, maxiter);
    if bounded {
        ISLANDS.fetch_add(1, Ordering::SeqCst);
    }
    let risk = 1.0 - stability;
    let verdict: &[u8] = if bounded {
        b"robust island"
    } else if stability > 0.5 {
        b"fragile boundary"
    } else {
        b"escape zone"
    };
    let mut out = Out::new(160);
    out.push(b"{\"c\":[");
    out.push_f64(cr);
    out.push(b",");
    out.push_f64(ci);
    out.push(b"],\"escape\":");
    out.push_dec(e as i64);
    out.push(b",\"maxiter\":");
    out.push_dec(maxiter as i64);
    out.push(b",\"bounded\":");
    out.push(if bounded { b"true" } else { b"false" });
    out.push(b",\"stability\":");
    out.push_f64(stability);
    out.push(b",\"risk\":");
    out.push_f64(risk);
    out.push(b",\"verdict\":\"");
    out.push(verdict);
    out.push(b"\"}");
    out
}

fn tool_robust_island(arg: &[u8]) -> Out {
    SCANS.fetch_add(1, Ordering::SeqCst);
    let mut s = Scanner::new(arg);
    let cr = s.next_f64().unwrap_or(0.0);
    let ci = s.next_f64().unwrap_or(0.0);
    let maxiter = clamp_iter(s.next_i64(300));
    let (e, bounded, stability) = classify(cr, ci, maxiter);
    if bounded {
        ISLANDS.fetch_add(1, Ordering::SeqCst);
    }
    let mut out = Out::new(128);
    out.push(b"{\"bounded\":");
    out.push(if bounded { b"true" } else { b"false" });
    out.push(b",\"depth\":");
    out.push_dec(e as i64);
    out.push(b",\"stability\":");
    out.push_f64(stability);
    out.push(b",\"island\":");
    out.push(if bounded { b"true" } else { b"false" });
    out.push(b"}");
    out
}

/// Fold a numeric series into (re,im) pairs and measure how much stays bounded.
fn fold_pairs(arg: &[u8], maxiter: u32) -> (i64, i64) {
    let mut s = Scanner::new(arg);
    let mut pairs: i64 = 0;
    let mut bounded: i64 = 0;
    loop {
        let a = s.next_f64();
        let b = s.next_f64();
        match (a, b) {
            (Some(cr), Some(ci)) => {
                pairs += 1;
                let (_, is_bounded, _) = classify(cr, ci, maxiter);
                if is_bounded {
                    bounded += 1;
                }
            }
            _ => break,
        }
    }
    (pairs, bounded)
}

fn tool_signal_filter(arg: &[u8]) -> Out {
    SCANS.fetch_add(1, Ordering::SeqCst);
    let (pairs, bounded) = fold_pairs(arg, 160);
    ISLANDS.fetch_add(bounded as u32, Ordering::SeqCst);
    let frac = if pairs > 0 { (bounded as f64) / (pairs as f64) } else { 0.0 };
    let signal: &[u8] = if pairs == 0 {
        b"insufficient"
    } else if frac >= 0.6 {
        b"accumulation"
    } else if frac >= 0.3 {
        b"transition"
    } else {
        b"breakout"
    };
    let mut out = Out::new(160);
    out.push(b"{\"points\":");
    out.push_dec(pairs);
    out.push(b",\"bounded\":");
    out.push_dec(bounded);
    out.push(b",\"bounded_fraction\":");
    out.push_f64(frac);
    out.push(b",\"signal\":\"");
    out.push(signal);
    out.push(b"\"}");
    out
}

fn tool_swarm_stability(arg: &[u8]) -> Out {
    SCANS.fetch_add(1, Ordering::SeqCst);
    let (agents, bounded) = fold_pairs(arg, 200);
    ISLANDS.fetch_add(bounded as u32, Ordering::SeqCst);
    let stability = if agents > 0 { (bounded as f64) / (agents as f64) } else { 0.0 };
    let verdict: &[u8] = if agents == 0 {
        b"no agents"
    } else if stability >= 0.66 {
        b"stable attractor"
    } else if stability >= 0.33 {
        b"approaching escape"
    } else {
        b"chaotic divergence"
    };
    let mut out = Out::new(160);
    out.push(b"{\"agents\":");
    out.push_dec(agents);
    out.push(b",\"bounded\":");
    out.push_dec(bounded);
    out.push(b",\"stability\":");
    out.push_f64(stability);
    out.push(b",\"verdict\":\"");
    out.push(verdict);
    out.push(b"\"}");
    out
}

fn tool_echo_state(arg: &[u8]) -> Out {
    // Any unknown tool (incl. "echo"/"tick"/"stats" the inspector may probe)
    // returns the oracle's live state so it behaves gracefully everywhere.
    let scans = SCANS.load(Ordering::SeqCst);
    let islands = ISLANDS.load(Ordering::SeqCst);
    let mut out = Out::new(arg.len() + 96);
    out.push(b"{\"oracle\":\"axiom\",\"scans\":");
    out.push_dec(scans as i64);
    out.push(b",\"islands_found\":");
    out.push_dec(islands as i64);
    out.push(b"}");
    out
}

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
        b"mandelbrot_scan" => tool_scan(arg),
        b"escape_time_risk" => tool_escape_risk(arg),
        b"robust_island_query" => tool_robust_island(arg),
        b"fractal_signal_filter" => tool_signal_filter(arg),
        b"swarm_stability_map" => tool_swarm_stability(arg),
        _ => tool_echo_state(arg),
    };
    out.packed()
}
