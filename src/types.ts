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
	totalNodes: number;
}
