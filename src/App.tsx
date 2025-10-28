import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { CONFIG, TAG_DISPLAY_NAMES, type GraphConfig } from "./config";
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
		if (cached) {
			return cached;
		}
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
					blockedby: user.blockedby || "",
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
	const graphRef = useRef<any>(null);
	const zoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const workerRef = useRef<Worker | null>(null);
	const lastClickRef = useRef<{ nodeId: string; time: number } | null>(null);

	useEffect(() => {
		workerRef.current = new Worker(
			new URL("./worker.ts", import.meta.url),
			{ type: "module" }
		);
		workerRef.current.onmessage = (
			event: MessageEvent<{
				filteredNodeIds?: string[];
				filteredLinkIds?: string[];
				searchedNodeId?: string | null;
				textLineCache?: Record<string, string[]>;
				nodeSizeCache?: Record<string, number>;
			}>
		) => {
			if (event.data.filteredNodeIds !== undefined) {
				setWorkerFilteredNodeIds(new Set(event.data.filteredNodeIds));
				setWorkerSearchedNodeId(event.data.searchedNodeId || null);
			}
			if (event.data.textLineCache !== undefined) {
				setTextLineCache(event.data.textLineCache);
			}
			if (event.data.nodeSizeCache !== undefined) {
				setNodeSizeCache(event.data.nodeSizeCache);
			}
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
			type: "filter",
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

	useEffect(() => {
		if (selectedNode && !userInfo && !loadingUserInfo) {
			(async () => {
				const cached = await getUserFromCache(selectedNode.name);
				if (cached) {
					setUserInfo(cached);
				}
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
		if (filteredNodes.length === 0 || !config) return;
		workerRef.current?.postMessage({
			type: "textCache",
			nodes: filteredNodes,
		});
		workerRef.current?.postMessage({
			type: "nodeSize",
			nodes: filteredNodes,
			nodeSizeMultiplier: config.nodeSizeMultiplier,
		});
	}, [filteredNodes, config]);

	const handleNodeCanvasObject = useCallback(
		(node: GraphNode2D, ctx: CanvasRenderingContext2D) => {
			if (!config) return;
			const size =
				nodeSizeCache[node.id] ??
				Math.sqrt(node.incomingCount + node.outgoingCount || 1) *
					config.nodeSizeMultiplier;
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
		[config, workerSearchedNodeId, zoomLevel, textLineCache, nodeSizeCache]
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
					<div className="info-item">
						<strong>链入：</strong> {selectedNode.incomingCount}
					</div>
					<div className="info-item">
						<strong>链出：</strong> {selectedNode.outgoingCount}
					</div>
					<div className="node-tags">
						<strong>标签：</strong>
						{selectedNode.tags.length > 0 ? (
							<div id="tags">
								{selectedNode.tags.map(tag => (
									<span
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
										style={{
											background:
												config.colorGroups[
													tag as keyof typeof config.colorGroups
												],
											color: "#eceff4",
											cursor: "pointer",
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
						disabled={loadingUserInfo}
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
