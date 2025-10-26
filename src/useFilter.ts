import { useState, useMemo } from "react";
import type { GraphNode, GraphLink } from "./types";

interface UseFilterReturn {
	searchTerm: string;
	setSearchTerm: (term: string) => void;
	selectedTags: Set<string>;
	toggleTag: (tag: string) => void;
	clearTags: () => void;
	filteredNodes: GraphNode[];
	filteredLinks: GraphLink[];
	searchedNodeId: string | null;
}

export const useFilter = (
	nodes: GraphNode[],
	links: GraphLink[]
): UseFilterReturn => {
	const [searchTerm, setSearchTerm] = useState("");
	const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

	const {
		filteredNodes,
		filteredLinks,
		searchedNodeId: searchedNodeIdFromMemo,
	} = useMemo(() => {
		if (searchTerm.trim() === "" && selectedTags.size === 0) {
			return {
				filteredNodes: nodes,
				filteredLinks: links,
				searchedNodeId: null,
			};
		}

		let resultNodeIds = new Set<string>();
		let searchedNodeIdResult: string | null = null;

		if (searchTerm.trim() !== "") {
			const searchLower = searchTerm.toLowerCase();
			const matchedNode = nodes.find(
				node => node.name.toLowerCase() === searchLower
			);

			if (matchedNode) {
				resultNodeIds.add(matchedNode.id);
				searchedNodeIdResult = matchedNode.id;

				links.forEach(link => {
					if (link.source === matchedNode.id) {
						resultNodeIds.add(link.target);
					} else if (link.target === matchedNode.id) {
						resultNodeIds.add(link.source);
					}
				});
			} else {
				return {
					filteredNodes: [],
					filteredLinks: [],
					searchedNodeId: null,
				};
			}
		}

		if (selectedTags.size > 0) {
			const tagFilteredNodeIds = new Set<string>();
			nodes.forEach(node => {
				if (node.tags.some(tag => selectedTags.has(tag))) {
					tagFilteredNodeIds.add(node.id);
				}
			});

			if (searchTerm.trim() !== "") {
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

		const resultNodes = nodes.filter(node => resultNodeIds.has(node.id));

		const resultLinks: GraphLink[] = [];
		links.forEach(link => {
			if (
				resultNodeIds.has(link.source) &&
				resultNodeIds.has(link.target)
			) {
				resultLinks.push(link);
			}
		});

		return {
			filteredNodes: resultNodes,
			filteredLinks: resultLinks,
			searchedNodeId: searchedNodeIdResult,
		};
	}, [nodes, links, searchTerm, selectedTags]);

	const toggleTag = (tag: string) => {
		setSelectedTags(prev => {
			const next = new Set(prev);
			if (next.has(tag)) {
				next.delete(tag);
			} else {
				next.add(tag);
			}
			return next;
		});
	};

	const clearTags = () => {
		setSelectedTags(new Set());
	};

	return {
		searchTerm,
		setSearchTerm,
		selectedTags,
		toggleTag,
		clearTags,
		filteredNodes,
		filteredLinks,
		searchedNodeId: searchedNodeIdFromMemo,
	};
};
