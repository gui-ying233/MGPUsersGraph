import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
	base:
		command === "build"
			? "https://testingcf.jsdelivr.net/gh/gui-ying233/MGPUsersGraph@main/docs/"
			: "/MGPUsersGraph/",
	plugins: [react()],
	build: {
		outDir: "docs",
		sourcemap: true,
		rollupOptions: {
			output: {
				sourcemapPathTransform: relativeSourcePath =>
					relativeSourcePath,
			},
		},
	},
}));
