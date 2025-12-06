import { readFileSync, readdirSync, writeFileSync } from "fs";
import { resolve, basename } from "path";
import { homedir } from "os";

const dataDir = resolve(homedir(), "MGPUsers");

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
	abuse: "#808080",
};
const DEFAULT_COLOR = "#eceff4";

function normalizeTag(tag) {
	if (tag === "interface") return "interface-admin";
	if (tag === "special") return "special-contributor";
	return tag;
}

function parseMarkdownFile(filePath) {
	try {
		const content = readFileSync(filePath, "utf-8");
		const fileName = basename(filePath, ".md");

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
	return linkMatches.map(link => link.slice(2, -2).replaceAll("_", " "));
}

function getAllMarkdownFiles() {
	const files = [];
	const dir = readdirSync(dataDir);

	for (const file of dir) {
		if (file.endsWith(".md") && !file.startsWith(".")) {
			files.push(resolve(dataDir, file));
		}
	}

	return files;
}

(() => {
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

		const fileName = basename(filePath, ".md");
		nodeMap.set(fileName, node);

		const content = readFileSync(filePath, "utf-8");
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

	writeFileSync(
		"graph.json",
		JSON.stringify({ d: nodeDict, l: compressedLinks }, null, 0)
	);

	console.log(`Generated graph for ${filteredNodes.length} nodes`);
	console.log(`Total links: ${validLinks.length}`);
})();
