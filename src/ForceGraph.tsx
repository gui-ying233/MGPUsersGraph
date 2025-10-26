import { useEffect, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { GraphNode, GraphLink, GraphConfig } from "./types";

interface ForceGraphProps {
	nodes: GraphNode[];
	links: GraphLink[];
	config: GraphConfig;
	onNodeClick: (node: GraphNode) => void;
	searchedNodeId: string | null;
}

interface GraphNode2D extends GraphNode {
	x?: number;
	y?: number;
}

interface LinkWithCoords {
	source: GraphNode2D;
	target: GraphNode2D;
}

export const ForceGraph = ({
	nodes,
	links,
	config,
	onNodeClick,
	searchedNodeId,
}: ForceGraphProps) => {
	const graphRef = useRef<any>(null);

	useEffect(() => {
		if (graphRef.current) {
			graphRef.current
				.d3Force("charge")
				.strength(-config.forces.repelStrength);
			graphRef.current
				.d3Force("link")
				.distance(config.forces.linkDistance);
		}
	}, [config.forces]);

	const handleNodeCanvasObject = (
		node: GraphNode2D,
		ctx: CanvasRenderingContext2D
	) => {
		const connectionCount = node.connectionCount || 1;
		const size = Math.sqrt(connectionCount) * config.nodeSizeMultiplier;
		ctx.fillStyle = node.color;
		ctx.beginPath();
		ctx.arc(node.x ?? 0, node.y ?? 0, size, 0, 2 * Math.PI);
		ctx.fill();

		if (node.id === searchedNodeId) {
			ctx.strokeStyle = "#bf616a";
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(node.x ?? 0, node.y ?? 0, size + 2, 0, 2 * Math.PI);
			ctx.stroke();
		}
	};

	const handleLinkCanvasObject = (
		link: LinkWithCoords,
		ctx: CanvasRenderingContext2D
	) => {
		ctx.strokeStyle = "rgba(255,255,255,0.1)";
		ctx.lineWidth = config.lineSizeMultiplier;
		ctx.beginPath();
		ctx.moveTo(link.source.x ?? 0, link.source.y ?? 0);
		ctx.lineTo(link.target.x ?? 0, link.target.y ?? 0);
		ctx.stroke();
	};

	const handleNodeClick = (node: GraphNode2D) => {
		onNodeClick(node);
	};

	const nodeMap = new Map<string, GraphNode2D>();
	nodes.forEach(node => {
		nodeMap.set(node.id, node as GraphNode2D);
	});

	const convertedLinks: LinkWithCoords[] = links
		.map(link => ({
			source: nodeMap.get(link.source),
			target: nodeMap.get(link.target),
		}))
		.filter(
			link => link.source !== undefined && link.target !== undefined
		) as LinkWithCoords[];

	return (
		<div style={{ width: "100%", height: "100vh" }}>
			<ForceGraph2D
				ref={graphRef}
				graphData={{ nodes, links: convertedLinks }}
				nodeLabel="name"
				nodeCanvasObject={handleNodeCanvasObject}
				linkCanvasObject={handleLinkCanvasObject}
				onNodeClick={handleNodeClick}
				width={window.innerWidth}
				height={window.innerHeight}
			/>
		</div>
	);
};
