import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      displayName: string | null;
      loginProvider: string;
      role: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
    rawBody?: string;
    startTime?: [number, number];
  }
}
