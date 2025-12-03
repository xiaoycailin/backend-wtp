import Fastify from 'fastify'
import prismaPlugin from './plugins/prisma'
import userRoutes from './routes/user.route'
import gitwebhookRoutes from './routes/github-webhook.route'
import response from './plugins/response'

const buildServer = () => {
  const app = Fastify({ logger: true })
  response(app)
  app.register(prismaPlugin)
  app.register(userRoutes as any)
  app.register(gitwebhookRoutes as any)

  return app
}

export default buildServer
