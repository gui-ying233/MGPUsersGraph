import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(os.homedir(), "MGPUsers");
const outputDir = path.resolve(__dirname, "../docs/data");

const TAG_COLOR_MAP = {
	staff: "#198754",
	bureaucrat: "#6610F2",
	checkuser: "#673AB7",
	suppress: "#9C27B0",
	sysop: "#EC407A",
	"interface-admin": "#F55B42",
	patroller: "#F77F38",
	honoredmaintainer: "#FEBD45",
	techeditor: "#3F51B5",
	"file-maintainer": "#039BE5",
	bot: "#1E88E5",
	flood: "#1E88E5",
	goodeditor: "#1AA179",
	"special-contributor": "#595C5F",
};
const DEFAULT_COLOR = "#eceff4";

if (!fs.existsSync(outputDir)) {
	fs.mkdirSync(outputDir, { recursive: true });
} else {
	const files = fs.readdirSync(outputDir);
	for (const file of files) {
		fs.unlinkSync(path.resolve(outputDir, file));
	}
}

function normalizeTag(tag) {
	if (tag === "interface") return "interface-admin";
	if (tag === "special") return "special-contributor";
	return tag;
}

function parseMarkdownFile(filePath) {
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		const fileName = path.basename(filePath, ".md");

		const tagMatches = content.match(/#\w+/g) || [];
		const tags = [
			...new Set(tagMatches.map(t => normalizeTag(t.slice(1)))),
		];

		return { name: fileName, tags };
	} catch (error) {
		console.error(`Error parsing ${filePath}:`, error.message);
		return null;
	}
}

function findLinksInContent(content) {
	const linkMatches = content.match(/\[\[([^\]]+)\]\]/g) || [];
	return linkMatches.map(link => link.slice(2, -2));
}

function getAllMarkdownFiles() {
	const files = [];
	const dir = fs.readdirSync(dataDir);

	for (const file of dir) {
		if (file.endsWith(".md") && !file.startsWith(".")) {
			files.push(path.resolve(dataDir, file));
		}
	}

	return files;
}

async function main() {
	console.log("Generating graph data...");

	const files = getAllMarkdownFiles();
	console.log(`Found ${files.length} markdown files`);

	const nodeMap = new Map();
	const links = [];
	const linkSet = new Set();
	const connectionCountMap = new Map();

	for (const filePath of files) {
		const node = parseMarkdownFile(filePath);
		if (!node) continue;

		const fileName = path.basename(filePath, ".md");
		nodeMap.set(fileName, node);

		const content = fs.readFileSync(filePath, "utf-8");
		const linkedFiles = findLinksInContent(content);

		for (const linkedFile of linkedFiles) {
			const linkKey = `${fileName}-${linkedFile}`;
			if (!linkSet.has(linkKey)) {
				links.push({ source: fileName, target: linkedFile });
				linkSet.add(linkKey);
				connectionCountMap.set(
					fileName,
					(connectionCountMap.get(fileName) || 0) + 1
				);
				connectionCountMap.set(
					linkedFile,
					(connectionCountMap.get(linkedFile) || 0) + 1
				);
			}
		}
	}

	const nodeIds = new Set(Array.from(nodeMap.entries()).map(([id]) => id));

	const allReferencedIds = new Set();
	links.forEach(link => {
		allReferencedIds.add(link.source);
		allReferencedIds.add(link.target);
	});

	allReferencedIds.forEach(id => {
		if (!nodeMap.has(id)) {
			nodeMap.set(id, { name: id, tags: [] });
		}
	});

	const validLinks = links;

	const linkedNodeIds = new Set();
	validLinks.forEach(link => {
		linkedNodeIds.add(link.source);
		linkedNodeIds.add(link.target);
	});

	const filteredNodes = Array.from(nodeMap.entries())
		.filter(([id]) => linkedNodeIds.has(id))
		.map(([id, node]) => {
			let color = TAG_COLOR_MAP[node.tags[0]] || DEFAULT_COLOR;
			
			if (node.tags.length === 0 && validLinks.length > 0) {
				for (const link of validLinks) {
					if (link.source === id || link.target === id) {
						const connectedId = link.source === id ? link.target : link.source;
						const connectedNode = nodeMap.get(connectedId);
						if (connectedNode?.tags.length > 0) {
							color = TAG_COLOR_MAP[connectedNode.tags[0]] || DEFAULT_COLOR;
							break;
						}
					}
				}
			}
			
			return {
				id,
				name: node.name,
				tags: node.tags,
				color,
				connectionCount: connectionCountMap.get(id) || 0,
			};
		});

	const colorToEnum = {};
	const enumColors = [DEFAULT_COLOR];
	Object.values(TAG_COLOR_MAP).forEach(color => {
		if (!colorToEnum.hasOwnProperty(color)) {
			colorToEnum[color] = enumColors.length;
			enumColors.push(color);
		}
	});

	const nodeIdMap = {};
	const nodeDict = filteredNodes.map((node, idx) => {
		nodeIdMap[node.id] = idx;
		const nodeData = {
			n: node.id,
			e: colorToEnum[node.color],
		};
		if (node.tags.length > 0) {
			nodeData.t = node.tags;
		}
		if (node.connectionCount !== 1) {
			nodeData.k = node.connectionCount;
		}
		return nodeData;
	});

	const compressedLinks = validLinks.map(link => [
		nodeIdMap[link.source],
		nodeIdMap[link.target],
	]);

	fs.writeFileSync(
		path.resolve(outputDir, "graph.json"),
		JSON.stringify({ d: nodeDict, l: compressedLinks }, null, 0)
	);

	const config = {
		colorGroups: TAG_COLOR_MAP,
		e: enumColors,
		forces: {
			centerStrength: 1,
			repelStrength: 40,
			linkStrength: 2,
			linkDistance: 30,
			alpha: 0.1,
			alphaMin: 0.001,
		},
		nodeSizeMultiplier: 0.247941080729167,
		lineSizeMultiplier: 0.1,
		totalNodes: filteredNodes.length,
	};

	fs.writeFileSync(
		path.resolve(outputDir, "config.json"),
		JSON.stringify(config, null, 2)
	);

	console.log(`Generated config for ${filteredNodes.length} nodes`);
	console.log(`Total links: ${validLinks.length}`);
}

main().catch(console.error);
