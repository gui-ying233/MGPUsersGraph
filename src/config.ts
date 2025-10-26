export interface GraphConfig {
	colorGroups: Record<string, string>;
	e: string[];
	forces: {
		centerStrength: number;
		repelStrength: number;
		linkStrength: number;
		linkDistance: number;
		alpha: number;
		alphaMin: number;
	};
	nodeSizeMultiplier: number;
	lineSizeMultiplier: number;
	totalNodes: number;
}

export const TAG_DISPLAY_NAMES: Record<string, string> = {
	staff: "STAFF",
	bureaucrat: "行政员",
	checkuser: "用户查核员",
	suppress: "监督员",
	sysop: "管理员",
	"interface-admin": "界面管理员",
	patroller: "维护姬",
	honoredmaintainer: "荣誉维护人员",
	techeditor: "技术编辑员",
	"file-maintainer": "文件维护员",
	bot: "机器人",
	flood: "机器用户",
	"ipblock-exempt": "IP封禁豁免者",
	extendedconfirmed: "延伸确认用户",
	"manually-confirmed": "手动确认用户",
	goodeditor: "优质编辑者",
	"special-contributor": "特殊贡献者",
};

export const CONFIG: GraphConfig = {
	colorGroups: {
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
	},
	e: [
		"#eceff4",
		"#198754",
		"#6610F2",
		"#673AB7",
		"#9C27B0",
		"#EC407A",
		"#F55B42",
		"#F77F38",
		"#FEBD45",
		"#3F51B5",
		"#039BE5",
		"#1E88E5",
		"#1AA179",
		"#595C5F",
	],
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
	totalNodes: 10953,
};
