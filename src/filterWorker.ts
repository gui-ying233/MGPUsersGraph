interface GraphNode {
	id: string;
	name: string;
	tags: string[];
	color: string;
	connectionCount?: number;
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

interface FilterResult {
	filteredNodeIds: string[];
	filteredLinkIds: string[];
	searchedNodeId: string | null;
}

self.onmessage = (event: MessageEvent<FilterMessage>) => {
	const { nodes, links, searchTerm, selectedTags, tagIndexCache } =
		event.data;

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
			self.postMessage({
				filteredNodeIds: [],
				filteredLinkIds: [],
				searchedNodeId: null,
			} as FilterResult);
			return;
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

	self.postMessage({
		filteredNodeIds,
		filteredLinkIds,
		searchedNodeId: searchedNodeIdResult,
	} as FilterResult);
};
