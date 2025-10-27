import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { CONFIG, TAG_DISPLAY_NAMES, type GraphConfig } from "./config";
import "./App.css";

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

interface GraphNode2D extends GraphNode {
	x?: number;
	y?: number;
}

interface LinkWithCoords {
	source: GraphNode2D;
	target: GraphNode2D;
}

function App() {
	const [nodes, setNodes] = useState<GraphNode[]>([]);
	const [links, setLinks] = useState<GraphLink[]>([]);
	const [config, setConfig] = useState<GraphConfig | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
	const [searchTerm, setSearchTerm] = useState(() => {
		const params = new URLSearchParams(window.location.search);
		return params.get("search") || "";
	});
	const [selectedTags, setSelectedTags] = useState<Set<string>>(() => {
		const params = new URLSearchParams(window.location.search);
		const tags = params.get("tags");
		return tags ? new Set(tags.split(",")) : new Set();
	});
	const [zoomLevel, setZoomLevel] = useState(1);
	const [workerFilteredNodeIds, setWorkerFilteredNodeIds] = useState<
		Set<string>
	>(new Set());
	const [workerSearchedNodeId, setWorkerSearchedNodeId] = useState<
		string | null
	>(null);
	const graphRef = useRef<any>(null);
	const zoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const workerRef = useRef<Worker | null>(null);
	const lastClickRef = useRef<{ nodeId: string; time: number } | null>(null);

	useEffect(() => {
		workerRef.current = new Worker(
			new URL("./filterWorker.ts", import.meta.url),
			{ type: "module" }
		);
		workerRef.current.onmessage = (
			event: MessageEvent<{
				filteredNodeIds: string[];
				filteredLinkIds: string[];
				searchedNodeId: string | null;
			}>
		) => {
			setWorkerFilteredNodeIds(new Set(event.data.filteredNodeIds));
			setWorkerSearchedNodeId(event.data.searchedNodeId);
		};
		return () => {
			workerRef.current?.terminate();
		};
	}, []);

	useEffect(() => {
		const params = new URLSearchParams();
		if (searchTerm) {
			params.set("search", searchTerm);
		}
		if (selectedTags.size > 0) {
			params.set("tags", Array.from(selectedTags).join(","));
		}
		const newUrl = params.toString()
			? `${window.location.pathname}?${params.toString()}`
			: window.location.pathname;
		window.history.replaceState({}, "", newUrl);
	}, [searchTerm, selectedTags]);

	const handleZoom = useCallback((zoomTransform: any) => {
		if (zoomTimeoutRef.current) {
			clearTimeout(zoomTimeoutRef.current);
		}
		zoomTimeoutRef.current = setTimeout(() => {
			setZoomLevel(zoomTransform.k);
		}, 100);
	}, []);

	useEffect(() => {
		setConfig(CONFIG);
	}, []);

	useEffect(() => {
		if (!config) return;
		const loadGraph = async () => {
			try {
				const res = await fetch("./data/graph.json");
				const compressed = await res.json();

				const nodeArray = compressed.d.map((node: any) => ({
					id: node.n,
					name: node.n,
					tags: node.t || [],
					color: config.e[node.e !== undefined ? node.e : 0],
					connectionCount: node.k !== undefined ? node.k : 1,
				}));

				const decompressedLinks = compressed.l.map(
					(link: number[]) => ({
						source: nodeArray[link[0]].id,
						target: nodeArray[link[1]].id,
					})
				);

				setNodes(nodeArray);
				setLinks(decompressedLinks);
				setWorkerFilteredNodeIds(
					new Set(nodeArray.map((n: any) => n.id))
				);

				const validTags = new Set<string>();
				nodeArray.forEach((node: any) => {
					node.tags.forEach((tag: string) => {
						validTags.add(tag);
					});
				});

				const urlTags = Array.from(selectedTags);
				const validatedTags = new Set(
					urlTags.filter(tag => validTags.has(tag))
				);
				if (validatedTags.size !== selectedTags.size) {
					setSelectedTags(validatedTags);
				}

				setLoading(false);
			} catch (err) {
				setError(`Failed to load graph data: ${err}`);
				setLoading(false);
			}
		};
		loadGraph();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [config]);

	const tagIndexCache = useMemo(() => {
		const cache = new Map<string, Set<string>>();
		nodes.forEach(node => {
			node.tags.forEach(tag => {
				if (!cache.has(tag)) cache.set(tag, new Set());
				cache.get(tag)!.add(node.id);
			});
		});
		return cache;
	}, [nodes]);

	useEffect(() => {
		if (searchTerm.trim() === "" && selectedTags.size === 0) {
			setWorkerFilteredNodeIds(new Set(nodes.map(n => n.id)));
			setWorkerSearchedNodeId(null);
			return;
		}

		const cacheObj: Record<string, string[]> = {};
		tagIndexCache.forEach((ids, tag) => {
			cacheObj[tag] = Array.from(ids);
		});

		workerRef.current?.postMessage({
			nodes,
			links,
			searchTerm,
			selectedTags: Array.from(selectedTags),
			tagIndexCache: cacheObj,
		});
	}, [searchTerm, selectedTags, tagIndexCache, nodes, links]);

	const filteredNodes = useMemo(() => {
		return nodes.filter(node => workerFilteredNodeIds.has(node.id));
	}, [nodes, workerFilteredNodeIds]);

	const filteredLinks = useMemo(() => {
		return links.filter(
			link =>
				workerFilteredNodeIds.has(link.source) &&
				workerFilteredNodeIds.has(link.target)
		);
	}, [links, workerFilteredNodeIds]);

	useEffect(() => {
		if (!graphRef.current || filteredNodes.length === 0) return;

		setTimeout(() => {
			const centerNode = filteredNodes[0] as GraphNode2D;
			if (centerNode.x !== undefined && centerNode.y !== undefined) {
				graphRef.current?.centerAt(centerNode.x, centerNode.y, 300);
			}
		}, 50);
	}, [filteredNodes]);

	useEffect(() => {
		if (!config || !graphRef.current) return;
		graphRef.current
			.d3Force("charge")
			.strength(-config.forces.repelStrength);
		graphRef.current.d3Force("link").distance(config.forces.linkDistance);
		graphRef.current
			.d3Force("center")
			.strength(config.forces.centerStrength);

		const simulation = graphRef.current.d3Force("simulation");
		if (simulation) {
			simulation.alpha(config.forces.alpha || 0.1);
			simulation.alphaMin(config.forces.alphaMin || 0.001);
			simulation.velocityDecay(0.4);
		}
	}, [config]);

	const convertedLinks: LinkWithCoords[] = useMemo(() => {
		const nodeMap = new Map<string, GraphNode2D>();
		filteredNodes.forEach(node => {
			nodeMap.set(node.id, node as GraphNode2D);
		});

		return filteredLinks
			.map(link => ({
				source: nodeMap.get(link.source),
				target: nodeMap.get(link.target),
			}))
			.filter(
				link => link.source !== undefined && link.target !== undefined
			) as LinkWithCoords[];
	}, [filteredNodes, filteredLinks]);

	const textLineCache = useMemo(() => {
		const cache = new Map<string, string[]>();
		filteredNodes.forEach(node => {
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
			cache.set(node.id, lines);
		});
		return cache;
	}, [filteredNodes]);

	const handleNodeCanvasObject = useCallback(
		(node: GraphNode2D, ctx: CanvasRenderingContext2D) => {
			if (!config) return;
			const connectionCount = node.connectionCount || 1;
			const size = Math.sqrt(connectionCount) * config.nodeSizeMultiplier;
			ctx.fillStyle = node.color;
			ctx.beginPath();
			ctx.arc(node.x ?? 0, node.y ?? 0, size, 0, 2 * Math.PI);
			ctx.fill();

			if (node.id === workerSearchedNodeId) {
				ctx.strokeStyle = "#bf616a";
				ctx.lineWidth = 2;
				ctx.beginPath();
				ctx.arc(node.x ?? 0, node.y ?? 0, size + 2, 0, 2 * Math.PI);
				ctx.stroke();
			}

			if (zoomLevel > 1) {
				ctx.fillStyle = "#d8dee9";
				const fontSize = Math.max(2, Math.min(16, size * 1.2));
				ctx.font = `${fontSize}px sans-serif`;
				ctx.textAlign = "center";
				ctx.textBaseline = "top";

				const lines = textLineCache.get(node.id) || [];
				const lineHeight = fontSize + 2;
				const startY = (node.y ?? 0) + size + 4;

				lines.forEach((line, index) => {
					ctx.fillText(
						line,
						node.x ?? 0,
						startY + index * lineHeight
					);
				});
			}
		},
		[config, workerSearchedNodeId, zoomLevel, textLineCache]
	);

	const handleLinkCanvasObject = useCallback(
		(link: LinkWithCoords, ctx: CanvasRenderingContext2D) => {
			if (!config) return;
			ctx.strokeStyle = "rgba(255,255,255,0.1)";
			ctx.lineWidth = config.lineSizeMultiplier;
			ctx.beginPath();
			ctx.moveTo(link.source.x ?? 0, link.source.y ?? 0);
			ctx.lineTo(link.target.x ?? 0, link.target.y ?? 0);
			ctx.stroke();
		},
		[config]
	);

	const handleNodeLabel = useCallback(
		(node: GraphNode2D) => {
			return zoomLevel > 1 ? "" : node.name;
		},
		[zoomLevel]
	);

	const handleCenterGraph = useCallback(() => {
		if (!graphRef.current) return;
		graphRef.current.zoomToFit(400, 50);
	}, []);

	const graphData = useMemo(
		() => ({ nodes: filteredNodes, links: convertedLinks }),
		[filteredNodes, convertedLinks]
	);

	if (error) {
		return (
			<div style={{ padding: "20px", color: "red" }}>
				<h2>Error</h2>
				<p>{error}</p>
			</div>
		);
	}

	if (!config) {
		return (
			<div style={{ padding: "20px" }}>
				<h2>加载中…</h2>
			</div>
		);
	}

	const allTags = Array.from(new Set(nodes.flatMap(n => n.tags)));

	return (
		<div id="app-container">
			{loading && nodes.length === 0 && (
				<div className="loading-overlay">
					<div className="loading-spinner">
						<div className="spinner"></div>
						<p>正在加载图表数据…</p>
					</div>
				</div>
			)}{" "}
			<div id="search-panel">
				<input
					type="text"
					placeholder="搜索用户…"
					value={searchTerm}
					onChange={e => setSearchTerm(e.target.value)}
					className="search-input"
				/>
				<div className="tag-filters">
					{allTags.map(tag => (
						<button
							key={tag}
							className={`tag-filter ${
								selectedTags.has(tag) ? "active" : ""
							}`}
							onClick={() => {
								setSelectedTags(prev => {
									const next = new Set(prev);
									if (next.has(tag)) {
										next.delete(tag);
									} else {
										next.add(tag);
									}
									return next;
								});
							}}
							style={
								selectedTags.has(tag)
									? {
											background:
												config.colorGroups[
													tag as keyof typeof config.colorGroups
												],
									  }
									: undefined
							}
						>
							{TAG_DISPLAY_NAMES[
								tag as keyof typeof TAG_DISPLAY_NAMES
							] || tag}
						</button>
					))}
				</div>
				{selectedTags.size > 0 && (
					<button
						className="clear-filters-btn"
						onClick={() => setSelectedTags(new Set())}
					>
						清除筛选
					</button>
				)}
			</div>
			{selectedNode && (
				<div id="node-detail-panel">
					<h3>{selectedNode.name}</h3>
					<div className="node-tags">
						<strong>标签：</strong>
						{selectedNode.tags.length > 0 ? (
							<div id="tags">
								{selectedNode.tags.map(tag => (
									<span
										key={tag}
										className="tag"
										style={{
											background:
												config.colorGroups[
													tag as keyof typeof config.colorGroups
												],
											color: "#eceff4",
										}}
									>
										{TAG_DISPLAY_NAMES[
											tag as keyof typeof TAG_DISPLAY_NAMES
										] || tag}
									</span>
								))}
							</div>
						) : (
							<p>没有标签</p>
						)}
					</div>
					<a
						href={`https://mzh.moegirl.org.cn/User:${encodeURIComponent(
							selectedNode.name
						)}?utm_medium=referral&utm_source=萌娘百科用户连接图&utm_content=${encodeURIComponent(
							window.location.href
						)}`}
						target="_blank"
						id="user-page-link"
					>
						访问用户页面
					</a>
				</div>
			)}
			<div style={{ width: "100%", height: "100vh" }}>
				<ForceGraph2D
					ref={graphRef}
					graphData={graphData}
					nodeLabel={handleNodeLabel}
					nodeCanvasObject={handleNodeCanvasObject}
					linkCanvasObject={handleLinkCanvasObject}
					onNodeClick={(node: GraphNode2D) => {
						const now = Date.now();
						if (
							lastClickRef.current &&
							lastClickRef.current.nodeId === node.id &&
							now - lastClickRef.current.time < 300
						) {
							setSearchTerm(node.id);
							lastClickRef.current = null;
						} else {
							setSelectedNode(node);
							lastClickRef.current = {
								nodeId: node.id,
								time: now,
							};
						}
					}}
					onZoom={handleZoom}
					width={window.innerWidth}
					height={window.innerHeight}
				/>
				<button
					onClick={handleCenterGraph}
					style={{
						position: "fixed",
						bottom: "20px",
						left: "20px",
						padding: "10px 16px",
						backgroundColor: "#2d3748",
						color: "#eceff4",
						border: "1px solid #4a5568",
						borderRadius: "4px",
						cursor: "pointer",
						fontSize: "14px",
						fontWeight: "500",
						zIndex: 10,
						transition: "all 0.3s ease",
					}}
					onMouseEnter={e => {
						const btn = e.currentTarget;
						btn.style.backgroundColor = "#4a5568";
						btn.style.transform = "scale(1.05)";
					}}
					onMouseLeave={e => {
						const btn = e.currentTarget;
						btn.style.backgroundColor = "#2d3748";
						btn.style.transform = "scale(1)";
					}}
				>
					居中
				</button>
			</div>
		</div>
	);
}

export default App;
