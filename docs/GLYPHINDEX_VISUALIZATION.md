# GlyphIndex Visualization Layer (Axiom + Loom)

**Fractal Navigation UI for Sovereign Memory Graphs.**

The visualization layer sits on top of the stable GlyphIndex contract. Agents can now not only seal and query memories, but *navigate* them visually—exploring personal graphs, federation topologies, and semantic relationships.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Axiom Dashboard (Real-Time Graph Visualization)               │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  GlyphGraph      │  │  Memory Timeline  │  │ Merkle Tree  │  │
│  │  Viewer          │  │  (episodic)      │  │ Anchor View  │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │ Semantic Zoom    │  │ Federation Mesh  │  │ Odù Map      │  │
│  │ (embeddings)     │  │ (peer glyphs)    │  │ (linkage)    │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↑
                              │ /api/glyphs/*
                              │
┌─────────────────────────────────────────────────────────────────┐
│  Vantage API Layer (GlyphIndex endpoints)                       │
│                                                                  │
│  /seal, /open, /merkle, /fold, /health                         │
└─────────────────────────────────────────────────────────────────┘
                              ↑
                              │
┌─────────────────────────────────────────────────────────────────┐
│  Core GlyphIndex Contract (3 wire formats)                      │
│                                                                  │
│  GIX-FOLD-v1 │ GIX-KDF-v1 │ GIX1 (Merkle roots)                │
│  (9 languages certified)                                        │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. GlyphGraph Viewer (React Component)

Display the agent's personal glyph graph as an interactive force-directed layout.

**Features:**
- **Nodes**: Each glyph (memory) is a node
  - Size = recency (recent = larger)
  - Color = semantic cluster (via embeddings)
  - Label = first 20 chars of plaintext (cached, not exposed)
- **Edges**: Relationships (mentions, references, follows-chain)
- **Hover**: Show Odù linkage (base + composed), canonical_id (last 8 chars)
- **Drag**: Reorganize nodes (local only, no persisted layout)
- **Click**: Inspect memory (decoded if authorized, else shows metadata only)

**Implementation:**
```typescript
// axiom/components/GlyphGraphViewer.tsx
interface GlyphNode {
  canonical_id: string;
  glyph: string;
  odu_base: number;
  odu_composed: number;
  ts: number;
  semantic_cluster?: number;
}

interface GlyphEdge {
  source: string; // canonical_id
  target: string; // canonical_id
  relationship: 'mentions' | 'references' | 'follows' | 'semantic_similarity';
  weight: number;
}

export const GlyphGraphViewer: React.FC<{
  agent_id: string;
  glyphs: GlyphNode[];
  edges: GlyphEdge[];
}> = ({ agent_id, glyphs, edges }) => {
  // Force-directed graph layout (D3 or Graphology)
  // Click → open memory inspector sidebar
};
```

### 2. Memory Timeline (Episodic View)

Vertical timeline showing agent's memories in chronological order.

**Features:**
- **Vertical axis**: Time (oldest → recent)
- **Cards**: Each memory as a card
  - Glyph (large, Unicode character)
  - Timestamp
  - First 40 chars (snippet)
  - Odù linkage badge
  - Merkle root (if anchored)
- **Filtering**: By semantic cluster, time range, Odù value
- **Playback**: Replay agent's thought sequence over time

**Implementation:**
```typescript
// axiom/components/MemoryTimeline.tsx
interface TimelineEntry {
  canonical_id: string;
  ts: number;
  glyph: string;
  snippet: string;
  merkle_root?: string;
}

export const MemoryTimeline: React.FC<{
  entries: TimelineEntry[];
  onSelect: (canonical_id: string) => void;
}> = ({ entries, onSelect }) => {
  // Vertical scrollable timeline
};
```

### 3. Merkle Tree Viewer

Show the hierarchical Merkle tree leading up to a root hash.

**Features:**
- **Binary tree layout**: Leaves (blobs) → intermediate nodes → root
- **Leaf nodes**: Canonical_id (truncated), blob hash (truncated)
- **Intermediate nodes**: SHA-256 hash of children
- **Root**: Full hash, anchor status on Sui (if available)
- **Hover**: Show full hashes, leaf counts

**Implementation:**
```typescript
// axiom/components/MerkleTreeViewer.tsx
interface MerkleNode {
  hash: string;
  is_leaf: boolean;
  blob_id?: string;
  children?: MerkleNode[];
  depth: number;
}

export const MerkleTreeViewer: React.FC<{
  root: MerkleNode;
  root_hash: string;
  sui_anchor?: string; // Sui tx hash if anchored
}> = ({ root, root_hash, sui_anchor }) => {
  // Hierarchical tree layout (D3 tree or custom)
};
```

### 4. Semantic Zoom (Embeddings + Clustering)

Project glyphs into a 2D semantic space (via UMAP or t-SNE on embeddings).

**Features:**
- **2D scatter plot**: Each glyph as a point (position = embedding)
- **Color**: Semantic cluster (k-means on embeddings)
- **Size**: Recency (timestamp)
- **Annotations**: Glyph character labels
- **Zoom**: Pan/zoom into clusters for detail

**Implementation:**
```typescript
// axiom/components/SemanticZoom.tsx
interface SemanticPoint {
  canonical_id: string;
  glyph: string;
  x: number; // UMAP/t-SNE coordinates
  y: number;
  cluster: number;
  ts: number;
}

export const SemanticZoom: React.FC<{
  points: SemanticPoint[];
  embedding_model: string; // e.g., "all-MiniLM-L6-v2"
}> = ({ points, embedding_model }) => {
  // 2D scatter plot with zoom/pan
};
```

### 5. Federation Mesh View

Show peer glyphs from guilds, collaborations, and federation events.

**Features:**
- **Nodes**: Agents (colored by role: trader, researcher, oracle, etc.)
- **Edges**: Shared glyph exchanges (animated during sync)
- **Glyph badges**: Floating glyphs between peers (Merkle roots exchanged)
- **Sidebar**: Federation status (peers online, last sync time, trust score)

**Implementation:**
```typescript
// axiom/components/FederationMeshView.tsx
interface PeerNode {
  agent_id: string;
  role: string;
  status: 'online' | 'offline';
  last_sync: number;
  trust_score: number;
}

interface GlyphExchange {
  from_agent: string;
  to_agent: string;
  merkle_root: string;
  ts: number;
}

export const FederationMeshView: React.FC<{
  peers: PeerNode[];
  exchanges: GlyphExchange[];
}> = ({ peers, exchanges }) => {
  // Network graph with animated glyph transfers
};
```

### 6. Odù Linkage Map

Visualize the Odù coordinate space (base 0–255, composed 0–65535).

**Features:**
- **Grid**: 256×256 pixel grid (one per Odù base value)
- **Heatmap**: Density of glyphs in each Odù region
- **Click**: Show all glyphs in that region
- **Legend**: Semantic meaning (If-Script Digital Calabash mapping)

**Implementation:**
```typescript
// axiom/components/OduLinkageMap.tsx
interface OduCell {
  base: number;
  count: number; // number of glyphs with this Odù base
  glyphs: string[]; // canonical_ids in this cell
}

export const OduLinkageMap: React.FC<{
  cells: OduCell[];
  onCellSelect: (base: number) => void;
}> = ({ cells, onCellSelect }) => {
  // 256×256 heatmap grid
};
```

## Wireframe Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  Axiom — GlyphIndex Memory Explorer                                 │
├─────────────────────────────────────────────────────────────────────┤
│ [Graph] [Timeline] [Merkle] [Semantic] [Federation] [Odù] | [Help] │
├─────────────────────────────────┬─────────────────────────────────┤
│                                 │                                 │
│   GlyphGraph Viewer             │  Inspector Sidebar              │
│                                 │                                 │
│     ◯ ← ž → ◯                   │  Canonical ID: a1b2c...f0a      │
│      \     /                    │  Glyph: ž (U+017E)             │
│       ◯ → ◯                     │  Odù: base=219, comp=56254     │
│                                 │                                 │
│   (Click node to inspect)       │  Timestamp: 2026-07-21 14:30   │
│                                 │                                 │
│   [↨ Force] [~ Semantic]        │  Merkle Root: fedcba...        │
│   [⟳ Animate] [⊗ Clear]        │  Anchored on Sui: TxHash...    │
│                                 │                                 │
│                                 │  [Decrypt] [Share] [Pin]       │
│                                 │                                 │
├─────────────────────────────────┴─────────────────────────────────┤
│  Status: Online | Peers: 3 | Synced: 42/42 glyphs                │
└─────────────────────────────────────────────────────────────────────┘
```

## API Integration

All visualization components call the Vantage GlyphIndex API:

```typescript
// Fetch agent's glyphs (metadata only, no plaintext)
const glyphs = await fetch('/api/glyphs/list', {
  headers: { 'X-Agent-Key': agentKey }
}).then(r => r.json());

// Get Merkle root for anchoring
const { root_hash } = await fetch('/api/glyphs/merkle', {
  method: 'POST',
  body: JSON.stringify({ canonical_ids: glyphs.map(g => g.canonical_id) })
}).then(r => r.json());

// Fold text for demo
const foldResult = await fetch(`/api/glyphs/fold/Àṣẹ`).then(r => r.json());
```

## Performance Considerations

- **Graph rendering**: Limit to 500 nodes (virtualize beyond)
- **Timeline**: Paginate entries (50 per view)
- **Merkle tree**: Cache tree structure, only compute roots on demand
- **Embeddings**: Pre-compute and cache UMAP coordinates (expensive)
- **Federation mesh**: WebSocket for real-time exchange animations

## Security Notes

- **No plaintext**: Visualization shows glyphs, Odù, timestamps only
- **Glyph is safe**: Display character is cosmetic; canonical_id is the address
- **Auth required**: All API calls need `X-Agent-Key`
- **No leakage**: Sidebar inspector requires explicit agent consent to decrypt

## Roadmap

### Phase 1 (MVP): Core Visualization
- [ ] GlyphGraph Viewer (force-directed, D3 or Graphology)
- [ ] Memory Timeline (vertical scrollable)
- [ ] Inspector Sidebar (metadata + decrypt button)
- [ ] Odù Linkage Map (heatmap)

### Phase 2: Enhancements
- [ ] Merkle Tree Viewer (hierarchical)
- [ ] Semantic Zoom (UMAP embeddings)
- [ ] Federation Mesh (peer network)
- [ ] Graph export (SVG/PNG)

### Phase 3: Advanced
- [ ] Memory playback (replay agent's thought sequence)
- [ ] Collaborative editing (multi-agent graph merging)
- [ ] On-chain Merkle verification (read Sui roots)
- [ ] Real-time peer sync animation

## Libraries

Recommended:
- **Graph rendering**: D3.js, Graphology, or Vis.js
- **Embeddings layout**: UMAP-JS, tSNE.js
- **Tree layout**: D3 tree, React Flow
- **UI framework**: React, TailwindCSS, Recharts (charts)
- **WebSocket**: Socket.io for federation updates

## Example: Fetch & Visualize

```typescript
async function initGlyphExplorer(agentKey: string) {
  // Fetch agent's glyphs
  const glyphsRes = await fetch('/api/glyphs/list', {
    headers: { 'X-Agent-Key': agentKey }
  });
  const { glyphs } = await glyphsRes.json();

  // Fetch Merkle root (for all glyphs)
  const merkleRes = await fetch('/api/glyphs/merkle', {
    method: 'POST',
    body: JSON.stringify({ 
      canonical_ids: glyphs.map(g => g.canonical_id) 
    })
  });
  const { root_hash, leaf_count } = await merkleRes.json();

  // Render GlyphGraph
  const explorer = new GlyphExplorer({
    nodes: glyphs.map(g => ({
      id: g.canonical_id,
      label: g.glyph,
      data: g
    })),
    rootHash: root_hash,
    leafCount: leaf_count
  });

  explorer.render('#app');
}
```

## See Also

- `GLYPHINDEX_API.md` — API endpoints
- `OSOVM/GLYPHINDEX_SPEC.md` — Wire format spec
- `Axiom` — Dashboard repo (Three.js 3D, real-time updates)
- `Loom` — Fractal navigation engine (Python, semantic space)
