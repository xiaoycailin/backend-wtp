import buildServer from './server'

const start = async () => {
  const server = buildServer()
  try {
    await server.listen({ port: 3000 })
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

start()
