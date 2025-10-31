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

interface ForceParamsMessage {
	type: "forceParams";
	filteredNodes: GraphNode[];
	filteredLinks: GraphLink[];
	baseConfig: { centerStrength: number };
	isFiltered: boolean;
	canvasWidth: number;
	canvasHeight: number;
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

interface ForceParamsResult {
	distanceMax: number;
	centerStrength: number;
}

function buildTextLineCache(nodes: GraphNode[]): Record<string, string[]> {
	const cache: Record<string, string[]> = {};
	nodes.forEach(node => {
		const lines: string[] = [];
		let currentLine = "";
		for (const char of node.name) {
			currentLine += char;
			if (currentLine.length >= 25) {
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

let cachedAllNodesFilterResult: FilterResult | null = null;
let cachedTextLineCache: Record<string, string[]> | null = null;
let cachedNodeSizeCache: Record<string, number> | null = null;
let cachedForceParams: { distanceMax: number; centerStrength: number } | null =
	null;
let lastFilteredNodeCount: number | null = null;

function calculateForceParams(
	filteredNodes: GraphNode[],
	filteredLinks: GraphLink[],
	baseConfig: { centerStrength: number },
	canvasWidth: number,
	canvasHeight: number
): { distanceMax: number; centerStrength: number } {
	const isolatedNodes = filteredNodes.filter(node => {
		return !filteredLinks.some(
			link => link.source === node.id || link.target === node.id
		);
	});

	if (isolatedNodes.length === 0) {
		return {
			distanceMax: Infinity,
			centerStrength: baseConfig.centerStrength,
		};
	}

	const diagonalLength = Math.sqrt(
		canvasWidth * canvasWidth + canvasHeight * canvasHeight
	);
	const distanceMax = diagonalLength / 6;

	const isolatedRatio = isolatedNodes.length / filteredNodes.length;
	const enhancedCenterStrength =
		baseConfig.centerStrength * (1 + isolatedRatio * 1.2);

	return {
		distanceMax,
		centerStrength: Math.min(enhancedCenterStrength, 3),
	};
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

	const filteredNodeIds = Array.from(resultNodeIds);
	const filteredLinkIds: string[] = [];

	links.forEach(link => {
		if (resultNodeIds.has(link.source) && resultNodeIds.has(link.target)) {
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
	event: MessageEvent<
		(
			| FilterMessage
			| TextCacheMessage
			| NodeSizeMessage
			| ForceParamsMessage
		) & { taskId: string }
	>
) => {
	const message = event.data;
	const { taskId, type } = message;

	try {
		if (type === "filter") {
			const filterMessage = message as FilterMessage;
			if (
				filterMessage.searchTerm.trim() === "" &&
				filterMessage.selectedTags.length === 0
			) {
				if (cachedAllNodesFilterResult) {
					self.postMessage({
						taskId,
						result: cachedAllNodesFilterResult,
					});
					return;
				}
				const result = processFilter(
					filterMessage.nodes,
					filterMessage.links,
					filterMessage.searchTerm,
					filterMessage.selectedTags,
					filterMessage.tagIndexCache
				);
				cachedAllNodesFilterResult = result;
				self.postMessage({
					taskId,
					result,
				});
			} else {
				const result = processFilter(
					filterMessage.nodes,
					filterMessage.links,
					filterMessage.searchTerm,
					filterMessage.selectedTags,
					filterMessage.tagIndexCache
				);
				self.postMessage({
					taskId,
					result,
				});
			}
		} else if (type === "textCache") {
			const textMessage = message as TextCacheMessage;
			if (cachedTextLineCache) {
				self.postMessage({
					taskId,
					result: {
						textLineCache: cachedTextLineCache,
					} as TextCacheResult,
				});
				return;
			}
			cachedTextLineCache = buildTextLineCache(textMessage.nodes);
			self.postMessage({
				taskId,
				result: {
					textLineCache: cachedTextLineCache,
				} as TextCacheResult,
			});
		} else if (type === "nodeSize") {
			const nodeSizeMessage = message as NodeSizeMessage;
			if (cachedNodeSizeCache) {
				self.postMessage({
					taskId,
					result: {
						nodeSizeCache: cachedNodeSizeCache,
					} as NodeSizeResult,
				});
				return;
			}
			cachedNodeSizeCache = buildNodeSizeCache(
				nodeSizeMessage.nodes,
				nodeSizeMessage.nodeSizeMultiplier
			);
			self.postMessage({
				taskId,
				result: {
					nodeSizeCache: cachedNodeSizeCache,
				} as NodeSizeResult,
			});
		} else if (type === "forceParams") {
			const forceMessage = message as ForceParamsMessage;
			const currentNodeCount = forceMessage.filteredNodes.length;

			if (
				currentNodeCount === lastFilteredNodeCount &&
				cachedForceParams
			) {
				self.postMessage({
					taskId,
					result: cachedForceParams as ForceParamsResult,
				});
				return;
			}

			const result = calculateForceParams(
				forceMessage.filteredNodes,
				forceMessage.filteredLinks,
				forceMessage.baseConfig,
				forceMessage.canvasWidth,
				forceMessage.canvasHeight
			);

			cachedForceParams = result;
			lastFilteredNodeCount = currentNodeCount;

			self.postMessage({
				taskId,
				result: result as ForceParamsResult,
			});
		}
	} catch (error) {
		self.postMessage({
			taskId,
			error: error instanceof Error ? error.message : "Unknown error",
		});
	}
};
