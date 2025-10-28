interface GraphNode {
	id: string;
	name: string;
	tags: string[];
	color: string;
	incomingCount: number;
	outgoingCount: number;
}

interface GraphLink {
	source: string;
	target: string;
}

interface FilterMessage {
	type: "filter";
	nodes: GraphNode[];
	links: GraphLink[];
	searchTerm: string;
	selectedTags: string[];
	tagIndexCache: Record<string, string[]>;
}

interface TextCacheMessage {
	type: "textCache";
	nodes: GraphNode[];
}

interface NodeSizeMessage {
	type: "nodeSize";
	nodes: GraphNode[];
	nodeSizeMultiplier: number;
}

interface FilterResult {
	filteredNodeIds: string[];
	filteredLinkIds: string[];
	searchedNodeId: string | null;
}

interface TextCacheResult {
	textLineCache: Record<string, string[]>;
}

interface NodeSizeResult {
	nodeSizeCache: Record<string, number>;
}

function buildTextLineCache(nodes: GraphNode[]): Record<string, string[]> {
	const cache: Record<string, string[]> = {};
	nodes.forEach(node => {
		const charLimit = 25;
		const lines: string[] = [];
		let currentLine = "";
		for (const char of node.name) {
			currentLine += char;
			if (currentLine.length >= charLimit) {
				lines.push(currentLine);
				currentLine = "";
			}
		}
		if (currentLine) lines.push(currentLine);
		cache[node.id] = lines;
	});
	return cache;
}

function buildNodeSizeCache(
	nodes: GraphNode[],
	nodeSizeMultiplier: number
): Record<string, number> {
	const cache: Record<string, number> = {};
	nodes.forEach(node => {
		const connectionCount = node.incomingCount + node.outgoingCount || 1;
		cache[node.id] = Math.sqrt(connectionCount) * nodeSizeMultiplier;
	});
	return cache;
}

function processFilter(
	nodes: GraphNode[],
	links: GraphLink[],
	searchTerm: string,
	selectedTags: string[],
	tagIndexCache: Record<string, string[]>
): FilterResult {
	const sanitizedSearchTerm = (searchTerm || "").trim();
	const sanitizedTags = (selectedTags || []).filter(
		tag => typeof tag === "string" && tag in tagIndexCache
	);

	let resultNodeIds = new Set<string>();
	let searchedNodeIdResult: string | null = null;

	if (sanitizedSearchTerm !== "") {
		const matchedNode = nodes.find(
			node => node.name === sanitizedSearchTerm
		);

		if (matchedNode) {
			resultNodeIds.add(matchedNode.id);
			searchedNodeIdResult = matchedNode.id;

			const linkMap = new Map<string, GraphLink[]>();
			links.forEach(link => {
				if (!linkMap.has(link.source)) linkMap.set(link.source, []);
				if (!linkMap.has(link.target)) linkMap.set(link.target, []);
				linkMap.get(link.source)!.push(link);
				linkMap.get(link.target)!.push(link);
			});

			linkMap.get(matchedNode.id)?.forEach(link => {
				resultNodeIds.add(
					link.source === matchedNode.id ? link.target : link.source
				);
			});
		} else {
			return {
				filteredNodeIds: [],
				filteredLinkIds: [],
				searchedNodeId: null,
			};
		}
	}

	if (sanitizedTags.length > 0) {
		const tagFilteredNodeIds = new Set<string>();
		sanitizedTags.forEach(tag => {
			const nodeIds = tagIndexCache[tag] || [];
			nodeIds.forEach(nodeId => {
				tagFilteredNodeIds.add(nodeId);
			});
		});

		if (sanitizedSearchTerm !== "") {
			resultNodeIds = new Set(
				Array.from(resultNodeIds).filter(
					id =>
						tagFilteredNodeIds.has(id) ||
						id === searchedNodeIdResult
				)
			);
		} else {
			resultNodeIds = tagFilteredNodeIds;
		}
	}

	const resultNodeIdSet = resultNodeIds;
	const filteredNodeIds = Array.from(resultNodeIdSet);
	const filteredLinkIds: string[] = [];

	links.forEach(link => {
		if (
			resultNodeIdSet.has(link.source) &&
			resultNodeIdSet.has(link.target)
		) {
			filteredLinkIds.push(`${link.source}|${link.target}`);
		}
	});

	return {
		filteredNodeIds,
		filteredLinkIds,
		searchedNodeId: searchedNodeIdResult,
	};
}

self.onmessage = (
	event: MessageEvent<FilterMessage | TextCacheMessage | NodeSizeMessage>
) => {
	const message = event.data;

	if (message.type === "filter") {
		const filterMessage = message as FilterMessage;
		const result = processFilter(
			filterMessage.nodes,
			filterMessage.links,
			filterMessage.searchTerm,
			filterMessage.selectedTags,
			filterMessage.tagIndexCache
		);
		self.postMessage(result);
	} else if (message.type === "textCache") {
		const textMessage = message as TextCacheMessage;
		const textLineCache = buildTextLineCache(textMessage.nodes);
		self.postMessage({ textLineCache } as TextCacheResult);
	} else if (message.type === "nodeSize") {
		const nodeSizeMessage = message as NodeSizeMessage;
		const nodeSizeCache = buildNodeSizeCache(
			nodeSizeMessage.nodes,
			nodeSizeMessage.nodeSizeMultiplier
		);
		self.postMessage({ nodeSizeCache } as NodeSizeResult);
	}
};
