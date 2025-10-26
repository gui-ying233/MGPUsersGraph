import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	base: "/dist/",
	plugins: [react()],
	build: {
		sourcemap: true,
		rollupOptions: {
			output: {
				sourcemapPathTransform: relativeSourcePath =>
					relativeSourcePath,
			},
		},
	},
});
