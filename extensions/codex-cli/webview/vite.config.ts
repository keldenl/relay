/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const rootDir = __dirname;

export default defineConfig(({ command }) => {
	const isDev = command === 'serve';

	return {
		plugins: [react(), tailwindcss()],
		root: rootDir,
		base: './',
		resolve: {
			alias: {
				'@shared': path.resolve(rootDir, '../src/shared'),
			},
		},
		server: {
			port: 5173,
			strictPort: true,
			host: '127.0.0.1',
			https: false,
			hmr: {
				protocol: 'ws',
				host: '127.0.0.1',
				port: 5173,
			},
			fs: {
				allow: [rootDir, path.resolve(rootDir, '..')],
			},
		},
		build: {
			outDir: path.resolve(rootDir, '../media/webview-dist'),
			assetsDir: 'assets',
			sourcemap: true,
			manifest: true,
			target: 'es2020',
			rollupOptions: {
				input: path.resolve(rootDir, 'src/main.tsx'),
			},
		},
		esbuild: {
			legalComments: 'none',
		},
		define: {
			__DEV__: JSON.stringify(isDev),
		},
	};
});
