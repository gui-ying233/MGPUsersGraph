import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { CONFIG, TAG_DISPLAY_NAMES, type GraphConfig } from "./config";
import { WorkerPool, BatchProcessor } from "./workerPool";
import {
	type CompressedNode,
	type CompressedGraph,
	type QQHashEntry,
} from "./types";
import "./App.css";

interface UserInfo {
	username: string;
	editcount: number;
	registration: string;
	groups: string[];
	gender?: string;
	blockinfo?: {
		blockedby: string;
		blockid: number;
		blockreason: string;
		blockexpiry: string;
	};
	timestamp: number;
}

const DB_NAME = "MGPUsersGraph";
const DB_VERSION = 1;
const STORE_NAME = "users";

function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);

		request.onupgradeneeded = event => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: "username" });
			}
		};
	});
}

async function getUserFromCache(username: string): Promise<UserInfo | null> {
	try {
		const db = await openDB();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction([STORE_NAME], "readonly");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.get(username);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				const result = request.result;
				if (
					result &&
					Date.now() - result.timestamp < 7 * 24 * 60 * 60 * 1000
				) {
					resolve(result);
				} else {
					resolve(null);
				}
			};
		});
	} catch {
		return null;
	}
}

async function saveUserToCache(user: UserInfo): Promise<void> {
	try {
		const db = await openDB();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction([STORE_NAME], "readwrite");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.put(user);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	} catch {
		return;
	}
}

async function fetchUserInfo(
	username: string,
	skipCache = false
): Promise<UserInfo | null> {
	if (!skipCache) {
		const cached = await getUserFromCache(username);
		if (cached) return cached;
	}

	try {
		const response = await fetch("https://mzh.moegirl.org.cn/api.php", {
			method: "POST",
			body: new URLSearchParams({
				action: "query",
				format: "json",
				list: "users",
				utf8: "1",
				formatversion: "2",
				usprop: "blockinfo|editcount|registration|groups|gender",
				ususers: username,
				origin: "*",
			}),
		});

		if (!response.ok) {
			return null;
		}

		const data = await response.json();
		const users = data.query?.users;

		if (!users || users.length === 0) {
			return null;
		}

		const user = users[0];
		const rawGroups = (user.groups || []).filter((g: string) => g !== "*");

		const translatedGroups = rawGroups.map(
			(g: string) =>
				({
					autoconfirmed: "自动确认用户",
					bot: "机器人",
					bureaucrat: "行政员",
					checkuser: "用户查核员",
					extendedconfirmed: "延伸确认用户",
					"file-maintainer": "文件维护员",
					flood: "机器用户",
					goodeditor: "优质编辑者",
					honoredmaintainer: "荣誉维护人员",
					"interface-admin": "界面管理员",
					"ipblock-exempt": "IP封禁豁免者",
					"manually-confirmed": "手动确认用户",
					patroller: "维护姬",
					"push-subscription-manager": "推送订阅管理员",
					"special-contributor": "特殊贡献者",
					staff: "STAFF",
					suppress: "监督员",
					sysop: "管理员",
					techeditor: "技术编辑员",
					user: "用户",
				}[g] || g)
		);

		const blockinfo = user.blockedby
			? {
					blockedby: user.blockedby,
					blockid: user.blockid || 0,
					blockreason: user.blockreason || "",
					blockexpiry: user.blockexpiry || "",
			  }
			: undefined;

		const userInfo: UserInfo = {
			username: user.name,
			editcount: user.editcount || 0,
			registration: user.registration || "",
			groups: translatedGroups,
			gender: user.gender
				? (
						{ male: "男", female: "女", unknown: "未知" } as Record<
							string,
							string
						>
				  )[user.gender] || user.gender
				: undefined,
			blockinfo,
			timestamp: Date.now(),
		};

		await saveUserToCache(userInfo);
		return userInfo;
	} catch {
		return null;
	}
}

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
	const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
	const [loadingUserInfo, setLoadingUserInfo] = useState(false);
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
	const [textLineCache, setTextLineCache] = useState<
		Record<string, string[]>
	>({});
	const [nodeSizeCache, setNodeSizeCache] = useState<Record<string, number>>(
		{}
	);
	const [panelVisible, setPanelVisible] = useState(true);
	const [forceParams, setForceParams] = useState<{
		distanceMax: number;
		centerStrength: number;
	} | null>(null);
	const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
	const [hoveredTagId, setHoveredTagId] = useState<string | null>(null);
	const [QQHash, setQQHash] = useState<Record<string, QQHashEntry> | null>(
		null
	);
	const graphRef = useRef<any>(null);
	const zoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const workerPoolRef = useRef<WorkerPool | null>(null);
	const batchProcessorRef = useRef<BatchProcessor | null>(null);
	const lastClickRef = useRef<{ nodeId: string; time: number } | null>(null);
	const lastFilteredNodeIdsRef = useRef<Set<string>>(new Set());
	const allNodesCountRef = useRef<number>(0);

	useEffect(() => {
		workerPoolRef.current = new WorkerPool(navigator.hardwareConcurrency);

		batchProcessorRef.current = new BatchProcessor(50);

		batchProcessorRef.current.onUpdate(result => {
			if (result.filteredNodeIds !== undefined) {
				setWorkerFilteredNodeIds(result.filteredNodeIds);
				setWorkerSearchedNodeId(result.searchedNodeId || null);
			}
			if (result.textLineCache !== undefined) {
				setTextLineCache(result.textLineCache);
			}
			if (result.nodeSizeCache !== undefined) {
				setNodeSizeCache(result.nodeSizeCache);
			}
			if (result.forceParams !== undefined) {
				setForceParams(result.forceParams);
			}
		});

		return () => {
			workerPoolRef.current?.terminate();
			batchProcessorRef.current?.clear();
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
				const [graphRes, qqRes] = await Promise.all([
					fetch(
						"https://testingcf.jsdelivr.net/gh/gui-ying233/MGPUsersGraph/docs/data/graph.json",
						{
							priority: "high",
						}
					),
					fetch(
						"https://testingcf.jsdelivr.net/gh/gui-ying233/QQHash/QQHash.json",
						{
							priority: "high",
						}
					),
				]);

				const compressed: CompressedGraph = await graphRes.json();
				const QQHash = await qqRes.json();

				setQQHash(QQHash);

				const nodeArray = compressed.d.map((node: CompressedNode) => ({
					id: node.n,
					name: node.n,
					tags: node.t || [],
					color: config.e[node.e !== undefined ? node.e : 0],
					incomingCount: 0,
					outgoingCount: 0,
				}));

				const decompressedLinks = compressed.l.map(
					(link: number[]) => ({
						source: nodeArray[link[0]].id,
						target: nodeArray[link[1]].id,
					})
				);

				decompressedLinks.forEach((link: GraphLink) => {
					const sourceNode = nodeArray.find(
						(n: any) => n.id === link.source
					);
					const targetNode = nodeArray.find(
						(n: any) => n.id === link.target
					);
					if (sourceNode) sourceNode.incomingCount++;
					if (targetNode) targetNode.outgoingCount++;
				});

				setNodes(nodeArray);
				setLinks(decompressedLinks);
				setWorkerFilteredNodeIds(
					new Set(nodeArray.map((n: any) => n.id))
				);

				const validTags = new Set<string>();
				nodeArray.forEach((node: GraphNode) => {
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
		} else {
			const cacheObj: Record<string, string[]> = {};
			tagIndexCache.forEach((ids, tag) => {
				cacheObj[tag] = Array.from(ids);
			});

			if (workerPoolRef.current && batchProcessorRef.current) {
				const taskId = `filter-${Date.now()}-${Math.random()}`;
				batchProcessorRef.current.registerTask(taskId);

				workerPoolRef.current
					.addTask(
						"filter",
						{
							nodes,
							links,
							searchTerm,
							selectedTags: Array.from(selectedTags),
							tagIndexCache: cacheObj,
						},
						10
					)
					.then(result => {
						batchProcessorRef.current?.addResult(taskId, result);
					})
					.catch(error => {
						console.error("Filter task failed:", error);
						batchProcessorRef.current?.failTask(taskId);
					});
			}
		}
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

	const isFiltered = useMemo(() => {
		return searchTerm.trim() !== "" || selectedTags.size > 0;
	}, [searchTerm, selectedTags]);

	useEffect(() => {
		if (!workerPoolRef.current) return;

		if (!isFiltered) {
			setForceParams(null);
			return;
		}

		allNodesCountRef.current = nodes.length;

		const taskId = `forceParams-${Date.now()}-${Math.random()}`;
		batchProcessorRef.current?.registerTask(taskId);

		workerPoolRef.current
			.addTask(
				"forceParams",
				{
					filteredNodes,
					filteredLinks,
					baseConfig: {
						centerStrength: config?.forces.centerStrength || 1,
					},
					canvasWidth: window.innerWidth * 0.9,
					canvasHeight: window.innerHeight * 0.9,
				},
				20
			)
			.then(result => {
				batchProcessorRef.current?.addResult(taskId, result);
			})
			.catch(error => {
				console.error("ForceParams task failed:", error);
				batchProcessorRef.current?.failTask(taskId);
			});
	}, [filteredNodes, filteredLinks, isFiltered, config]);

	useEffect(() => {
		if (!graphRef.current || filteredNodes.length === 0 || !forceParams)
			return;

		setTimeout(() => {
			const centerNode = filteredNodes[0] as GraphNode2D;
			if (centerNode.x !== undefined && centerNode.y !== undefined) {
				graphRef.current?.centerAt(centerNode.x, centerNode.y, 300);
			}
		}, 50);
	}, [filteredNodes]);

	useEffect(() => {
		if (!config || !graphRef.current) return;

		const chargeForce = graphRef.current.d3Force("charge");
		chargeForce.strength(-config.forces.repelStrength);

		if (!forceParams) {
			chargeForce.distanceMax(Infinity);
			graphRef.current
				.d3Force("center")
				.strength(config.forces.centerStrength);
		} else {
			if (forceParams.distanceMax !== Infinity) {
				chargeForce.distanceMax(forceParams.distanceMax);
			}
			graphRef.current
				.d3Force("center")
				.strength(forceParams.centerStrength);
		}

		graphRef.current.d3Force("link").distance(config.forces.linkDistance);

		const simulation = graphRef.current.d3Force("simulation");
		if (simulation) {
			simulation.alpha(config.forces.alpha || 0.1);
			simulation.alphaMin(config.forces.alphaMin || 0.001);
			simulation.velocityDecay(0.4);
		}
	}, [config, forceParams]);

	useEffect(() => {
		if (!graphRef.current || filteredNodes.length === 0) return;

		const simulation = graphRef.current.d3Force("simulation");
		if (!simulation) return;

		const currentNodeIds = new Set(filteredNodes.map(n => n.id));
		const prevNodeIds = lastFilteredNodeIdsRef.current;

		if (
			currentNodeIds.size !== prevNodeIds.size ||
			Array.from(currentNodeIds).some(id => !prevNodeIds.has(id))
		) {
			simulation.alpha(0.3);
			simulation.restart();
		}

		lastFilteredNodeIdsRef.current = currentNodeIds;
	}, [filteredNodes, filteredLinks]);

	useEffect(() => {
		if (selectedNode && !userInfo && !loadingUserInfo) {
			(async () => {
				const cached = await getUserFromCache(selectedNode.name);
				if (cached) setUserInfo(cached);
			})();
		}
	}, [selectedNode, userInfo, loadingUserInfo]);

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

	useEffect(() => {
		if (
			nodes.length === 0 ||
			!config ||
			!workerPoolRef.current ||
			!batchProcessorRef.current
		) {
			return;
		}

		const textCacheTaskId = `textCache-${Date.now()}-${Math.random()}`;
		const nodeSizeTaskId = `nodeSize-${Date.now()}-${Math.random()}`;

		batchProcessorRef.current.registerTask(textCacheTaskId);
		batchProcessorRef.current.registerTask(nodeSizeTaskId);

		workerPoolRef.current
			.addTask("textCache", { nodes }, 50)
			.then(result => {
				batchProcessorRef.current?.addResult(textCacheTaskId, result);
			})
			.catch(error => {
				console.error("TextCache task failed:", error);
				batchProcessorRef.current?.failTask(textCacheTaskId);
			});

		workerPoolRef.current
			.addTask(
				"nodeSize",
				{
					nodes,
					nodeSizeMultiplier: config.nodeSizeMultiplier,
				},
				50
			)
			.then(result => {
				batchProcessorRef.current?.addResult(nodeSizeTaskId, result);
			})
			.catch(error => {
				console.error("NodeSize task failed:", error);
				batchProcessorRef.current?.failTask(nodeSizeTaskId);
			});
	}, [nodes, config]);

	const connectedNodesMap = useMemo(() => {
		const map = new Map<string, Set<string>>();
		filteredNodes.forEach(node => {
			map.set(node.id, new Set());
		});
		filteredLinks.forEach(link => {
			map.get(link.source)?.add(link.target);
			map.get(link.target)?.add(link.source);
		});
		return map;
	}, [filteredNodes, filteredLinks]);

	const handleNodeCanvasObject = useCallback(
		(node: GraphNode2D, ctx: CanvasRenderingContext2D) => {
			if (!config) return;
			const size =
				nodeSizeCache[node.id] ??
				Math.sqrt(node.incomingCount + node.outgoingCount || 1) *
					config.nodeSizeMultiplier;

			let fillStyle = node.color;
			const isHoveredNodeConnected =
				hoveredNodeId &&
				(node.id === hoveredNodeId ||
					connectedNodesMap.get(hoveredNodeId)?.has(node.id));
			const isHoveredTagMatch =
				hoveredTagId && node.tags.includes(hoveredTagId);

			if (hoveredNodeId && !isHoveredNodeConnected) {
				const rgb = parseInt(node.color.slice(1), 16);
				const r = (rgb >> 16) & 255;
				const g = (rgb >> 8) & 255;
				const b = rgb & 255;
				fillStyle = `rgba(${r},${g},${b},0.1)`;
			} else if (hoveredTagId && !isHoveredTagMatch) {
				const rgb = parseInt(node.color.slice(1), 16);
				const r = (rgb >> 16) & 255;
				const g = (rgb >> 8) & 255;
				const b = rgb & 255;
				fillStyle = `rgba(${r},${g},${b},0.1)`;
			}

			ctx.fillStyle = fillStyle;
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

			const shouldShowText =
				zoomLevel > 1 || isHoveredNodeConnected || isHoveredTagMatch;

			if (shouldShowText) {
				let textOpacity = 1;
				if (hoveredNodeId && !isHoveredNodeConnected) {
					textOpacity = 0.1;
				} else if (hoveredTagId && !isHoveredTagMatch) {
					textOpacity = 0.1;
				}
				ctx.fillStyle = `rgba(216,222,233,${textOpacity})`;
				const fontSize = Math.max(2, Math.min(16, size * 1.2));
				ctx.font = `${fontSize}px ui-sans-serif, sans-serif`;
				ctx.textAlign = "center";
				ctx.textBaseline = "top";

				const lines = textLineCache[node.id] || [];
				const lineHeight = fontSize + 2;
				const startY = (node.y ?? 0) + size + 4;

				lines.forEach((line: string) => {
					ctx.fillText(
						line,
						node.x ?? 0,
						startY + lines.indexOf(line) * lineHeight
					);
				});
			}
		},
		[
			config,
			workerSearchedNodeId,
			zoomLevel,
			textLineCache,
			nodeSizeCache,
			hoveredNodeId,
			hoveredTagId,
			connectedNodesMap,
		]
	);
	const handleLinkCanvasObject = useCallback(
		(link: LinkWithCoords, ctx: CanvasRenderingContext2D) => {
			if (!config) return;
			const isNodeHoverConnected =
				hoveredNodeId &&
				(link.source.id === hoveredNodeId ||
					link.target.id === hoveredNodeId);
			const isTagHighlight =
				hoveredTagId &&
				link.source.tags.includes(hoveredTagId) &&
				link.target.tags.includes(hoveredTagId);

			let strokeStyle = "rgba(255,255,255,0.1)";
			if (isNodeHoverConnected) {
				strokeStyle = "#FFF";
			} else if (hoveredTagId && !isTagHighlight) {
				strokeStyle = "rgba(255,255,255,0.1)";
			} else if (isTagHighlight) {
				strokeStyle = "#FFF";
			}

			ctx.strokeStyle = strokeStyle;
			ctx.lineWidth = config.lineSizeMultiplier;
			ctx.beginPath();
			ctx.moveTo(link.source.x ?? 0, link.source.y ?? 0);
			ctx.lineTo(link.target.x ?? 0, link.target.y ?? 0);
			ctx.stroke();
		},
		[config, hoveredNodeId, hoveredTagId]
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

	const allTags = Array.from(new Set(nodes.flatMap(n => n.tags))).sort(
		(a, b) => {
			const colorGroupsKeys = Object.keys(config.colorGroups);
			const indexA = colorGroupsKeys.indexOf(a);
			const indexB = colorGroupsKeys.indexOf(b);
			if (indexA === -1) return 1;
			if (indexB === -1) return -1;
			return indexA - indexB;
		}
	);

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
							onKeyDown={e => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									setSelectedTags(prev => {
										const next = new Set(prev);
										if (next.has(tag)) {
											next.delete(tag);
										} else {
											next.add(tag);
										}
										return next;
									});
								}
							}}
							aria-pressed={selectedTags.has(tag)}
							title={`${
								selectedTags.has(tag) ? "移除" : "添加"
							}标签：${
								TAG_DISPLAY_NAMES[
									tag as keyof typeof TAG_DISPLAY_NAMES
								] || tag
							}`}
							onMouseEnter={() => setHoveredTagId(tag)}
							onMouseLeave={() => setHoveredTagId(null)}
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
						onKeyDown={e => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								setSelectedTags(new Set());
							}
						}}
						aria-label={`清除筛选（当前选中 ${selectedTags.size} 个标签）`}
						title="清除所有标签筛选"
					>
						清除筛选
					</button>
				)}
			</div>
			{selectedNode && panelVisible && (
				<div id="node-detail-panel">
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							marginBottom: "15px",
						}}
					>
						<h3 style={{ margin: 0 }}>{selectedNode.name}</h3>
						<button
							onClick={() => setPanelVisible(false)}
							onKeyDown={e => {
								if (e.key === "Escape" || e.key === "Enter") {
									setPanelVisible(false);
								}
							}}
							aria-label="关闭详情面板"
							title="关闭详情面板"
							style={{
								background: "none",
								border: "none",
								color: "#d8dee9",
								fontSize: "20px",
								cursor: "pointer",
								padding: "0 4px",
								lineHeight: 1,
								transition: "color 0.2s",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								minWidth: "28px",
								minHeight: "28px",
								userSelect: "none",
							}}
							onMouseEnter={e =>
								(e.currentTarget.style.color = "#eceff4")
							}
							onMouseLeave={e =>
								(e.currentTarget.style.color = "#d8dee9")
							}
						>
							✕
						</button>
					</div>
					<div className="info-item">
						<strong>链入：</strong> {selectedNode.incomingCount}
					</div>
					<div className="info-item">
						<strong>链出：</strong> {selectedNode.outgoingCount}
					</div>
					{QQHash?.[selectedNode.name]?.QQ && (
						<div className="info-item">
							<strong>QQ：</strong> {QQHash[selectedNode.name].QQ}
						</div>
					)}
					<div className="node-tags">
						<strong>标签：</strong>
						{selectedNode.tags.length > 0 ? (
							<div id="tags">
								{selectedNode.tags.map(tag => (
									<button
										key={tag}
										className="tag"
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
										onKeyDown={e => {
											if (
												e.key === "Enter" ||
												e.key === " "
											) {
												e.preventDefault();
												setSelectedTags(prev => {
													const next = new Set(prev);
													if (next.has(tag)) {
														next.delete(tag);
													} else {
														next.add(tag);
													}
													return next;
												});
											}
										}}
										aria-pressed={selectedTags.has(tag)}
										title={`${
											selectedTags.has(tag)
												? "移除"
												: "添加"
										}标签：${
											TAG_DISPLAY_NAMES[
												tag as keyof typeof TAG_DISPLAY_NAMES
											] || tag
										}`}
										onMouseEnter={() =>
											setHoveredTagId(tag)
										}
										onMouseLeave={() =>
											setHoveredTagId(null)
										}
										style={{
											background:
												config.colorGroups[
													tag as keyof typeof config.colorGroups
												],
											color: "#eceff4",
											cursor: "pointer",
											border: "none",
											borderRadius: "4px",
											padding: "4px 8px",
											fontSize: "14px",
											fontWeight: "500",
											transition: "opacity 0.2s",
										}}
									>
										{TAG_DISPLAY_NAMES[
											tag as keyof typeof TAG_DISPLAY_NAMES
										] || tag}
									</button>
								))}
							</div>
						) : (
							<p>没有标签</p>
						)}
					</div>
					{userInfo && (
						<div id="user-info">
							<div className="info-item">
								<strong>编辑数：</strong> {userInfo.editcount}
							</div>
							{userInfo.registration && (
								<div className="info-item">
									<strong>注册时间：</strong>{" "}
									{new Date(userInfo.registration)
										.toLocaleString("zh-CN", {
											year: "numeric",
											month: "2-digit",
											day: "2-digit",
											hour: "2-digit",
											minute: "2-digit",
											second: "2-digit",
										})
										.replace(/\//g, "-")}
								</div>
							)}
							{userInfo.gender && (
								<div className="info-item">
									<strong>性别：</strong> {userInfo.gender}
								</div>
							)}
							{userInfo.groups.length > 0 && (
								<div className="info-item">
									<strong>用户组：</strong>
									<div id="user-groups">
										{userInfo.groups.map(group => (
											<span
												key={group}
												className="user-group"
											>
												{group}
											</span>
										))}
									</div>
								</div>
							)}
							{userInfo.blockinfo && (
								<div
									className="info-item"
									style={{ color: "#bf616a" }}
								>
									<strong>⚠️ 被封禁</strong>
									<div className="block-info">
										<div>
											封禁者：
											{userInfo.blockinfo.blockedby}
										</div>
										<div>
											原因：
											{userInfo.blockinfo.blockreason}
										</div>
										<div>
											到期：
											{userInfo.blockinfo.blockexpiry ===
											"infinite"
												? "无期限"
												: new Date(
														userInfo.blockinfo.blockexpiry
												  )
														.toLocaleString(
															"zh-CN",
															{
																year: "numeric",
																month: "2-digit",
																day: "2-digit",
																hour: "2-digit",
																minute: "2-digit",
																second: "2-digit",
															}
														)
														.replace(/\//g, "-")}
										</div>
									</div>
								</div>
							)}
						</div>
					)}
					<button
						id="load-user-info-btn"
						onClick={async () => {
							setLoadingUserInfo(true);
							const info = await fetchUserInfo(
								selectedNode.name,
								!!userInfo
							);
							setUserInfo(info);
							setLoadingUserInfo(false);
						}}
						onKeyDown={e => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								if (!loadingUserInfo) {
									(async () => {
										setLoadingUserInfo(true);
										const info = await fetchUserInfo(
											selectedNode.name,
											!!userInfo
										);
										setUserInfo(info);
										setLoadingUserInfo(false);
									})();
								}
							}
						}}
						disabled={loadingUserInfo}
						aria-busy={loadingUserInfo}
						title={
							loadingUserInfo
								? "正在加载..."
								: userInfo
								? "重新获取最新信息"
								: "加载更多信息"
						}
						style={{
							opacity: loadingUserInfo ? 0.6 : 1,
							cursor: loadingUserInfo ? "default" : "pointer",
						}}
					>
						{loadingUserInfo
							? "加载中..."
							: userInfo
							? "重新获取最新信息"
							: "加载更多信息"}
					</button>
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
							setUserInfo(null);
							setPanelVisible(true);
							lastClickRef.current = {
								nodeId: node.id,
								time: now,
							};
						}
					}}
					onNodeHover={(node: GraphNode2D | null) => {
						if (hoverTimeoutRef.current) {
							clearTimeout(hoverTimeoutRef.current);
						}
						hoverTimeoutRef.current = setTimeout(() => {
							setHoveredNodeId(node?.id || null);
						}, 50);
					}}
					onZoom={handleZoom}
					warmupTicks={10}
					cooldownTicks={
						searchTerm.trim() === "" && selectedTags.size === 0
							? 0
							: undefined
					}
					width={window.innerWidth}
					height={window.innerHeight}
				/>
				<button
					onClick={handleCenterGraph}
					onKeyDown={e => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							handleCenterGraph();
						}
					}}
					aria-label="居中图表"
					title="按 Enter 或 Space 键也可以居中"
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
						minWidth: "44px",
						minHeight: "44px",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
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
