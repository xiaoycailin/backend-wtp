import Fastify from 'fastify'
import prismaPlugin from './plugins/prisma'
import userRoutes from './routes/user.route'
import response from './plugins/response'

const buildServer = () => {
  const app = Fastify({ logger: true })
  response(app)
  app.register(prismaPlugin)
  app.register(userRoutes as any)

  return app
}

export default buildServer
