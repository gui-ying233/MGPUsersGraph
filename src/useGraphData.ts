import { useState, useCallback, useEffect } from "react";
import type {
	GraphNode,
	GraphLink,
	GraphConfig,
	GraphDataChunk,
} from "./types";

interface UseGraphDataReturn {
	nodes: GraphNode[];
	links: GraphLink[];
	config: GraphConfig | null;
	loading: boolean;
	error: string | null;
	loadMore: () => Promise<void>;
	hasMore: boolean;
}

export const useGraphData = (): UseGraphDataReturn => {
	const [nodes, setNodes] = useState<GraphNode[]>([]);
	const [links, setLinks] = useState<GraphLink[]>([]);
	const [config, setConfig] = useState<GraphConfig | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [currentChunk, setCurrentChunk] = useState(0);
	const [totalChunks, setTotalChunks] = useState(0);

	useEffect(() => {
		const loadConfig = async () => {
			try {
				const res = await fetch("/data/config.json");
				const cfg = await res.json();
				setConfig(cfg);
				setTotalChunks(cfg.totalChunks || 1);
			} catch (err) {
				setError(`Failed to load config: ${err}`);
			}
		};

		loadConfig();
	}, []);

	useEffect(() => {
		if (!config) return;

		const loadInitialChunks = async () => {
			try {
				const res = await fetch(`/data/chunk-0.json`);
				const chunk: GraphDataChunk = await res.json();
				setNodes(chunk.nodes);
				setLinks(chunk.links);
				setCurrentChunk(1);
				setLoading(false);
			} catch (err) {
				setError(`Failed to load initial chunk: ${err}`);
				setLoading(false);
			}
		};

		loadInitialChunks();
	}, [config]);

	const loadMore = useCallback(async () => {
		if (currentChunk >= totalChunks) return;

		setLoading(true);
		try {
			const res = await fetch(`/data/chunk-${currentChunk}.json`);
			const chunk: GraphDataChunk = await res.json();

			setNodes(prev => [...prev, ...chunk.nodes]);
			setLinks(prev => [...prev, ...chunk.links]);
			setCurrentChunk(prev => prev + 1);
		} catch (err) {
			setError(`Failed to load chunk: ${err}`);
		} finally {
			setLoading(false);
		}
	}, [currentChunk, totalChunks]);

	return {
		nodes,
		links,
		config,
		loading,
		error,
		loadMore,
		hasMore: currentChunk < totalChunks,
	};
};
