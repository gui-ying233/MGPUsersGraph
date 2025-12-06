export interface GraphNode {
	id: string;
	name: string;
	tags: string[];
	color: string;
	connectionCount?: number;
}

export interface GraphLink {
	source: string;
	target: string;
}

export interface GraphDataChunk {
	nodes: GraphNode[];
	links: GraphLink[];
	chunkIndex: number;
	totalChunks: number;
}

export interface GraphConfig {
	colorGroups: Record<string, string>;
	forces: {
		centerStrength: number;
		repelStrength: number;
		linkStrength: number;
		linkDistance: number;
	};
	nodeSizeMultiplier: number;
	lineSizeMultiplier: number;
}

export interface ForceParams {
	distanceMax: number;
	centerStrength: number;
}

export interface CompressedNode {
	n: string;
	t?: string[];
	e?: number;
}

export interface CompressedGraph {
	d: CompressedNode[];
	l: number[][];
}

export interface QQHashEntry {
	H: string;
	Q: number | null;
}
