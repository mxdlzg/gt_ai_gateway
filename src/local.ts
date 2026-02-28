import { Hono } from 'hono'
import { sutando } from 'sutando'
import Database from 'better-sqlite3'
import { join } from 'path'
import { serve } from '@hono/node-server'
import { setupRoutes } from './routes'

const DB_PATH = join(process.cwd(), 'local.db')

// 配置 Sutando 连接
sutando.addConnection({
  client: 'better-sqlite3',
  connection: {
    filename: DB_PATH,
  },
  useNullAsDefault: true,
})

const app = new Hono()

setupRoutes(app, 'local')

// 启动服务器
const port = parseInt(process.env.PORT || '3000', 10)
console.log(`Starting server on http://localhost:${port}`)

serve({
  fetch: app.fetch,
  port,
})
