import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	base: "/docs/",
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
});
