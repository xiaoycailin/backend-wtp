import Fastify from 'fastify'
import prismaPlugin from './plugins/prisma'
import userRoutes from './routes/user.route'
import gitwebhookRoutes from './routes/github-webhook.route'
import response from './plugins/response'
import fastifyRawBody from 'fastify-raw-body';
import productRoutes from './routes/products.route'
import categoryRoute from './routes/category.route'

const buildServer = () => {
  const app = Fastify({ logger: true })
  response(app)
  app.register(fastifyRawBody, {
    field: 'rawBody',       // nama property di request
    global: false,          // true = semua route, false = register manual
    runFirst: true,
    encoding: 'utf8',       // atau null untuk Buffer
  });
  app.register(prismaPlugin)
  app.register(userRoutes as any)
  app.register(categoryRoute as any)
  app.register(productRoutes as any)
  app.register(gitwebhookRoutes as any)

  return app
}

export default buildServer
