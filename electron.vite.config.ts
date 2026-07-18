import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [
      react(),
      // pdf.js needs CJK cMaps + fallback fonts served next to the app
      viteStaticCopy({
        targets: [
          { src: resolve('node_modules/pdfjs-dist/cmaps') + '/*', dest: 'pdfjs/cmaps' },
          {
            src: resolve('node_modules/pdfjs-dist/standard_fonts') + '/*',
            dest: 'pdfjs/standard_fonts'
          }
        ]
      })
    ]
  }
})
