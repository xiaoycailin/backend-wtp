export const createUserSchema = {
  type: "object",
  required: ["email", "displayName"],
  properties: {
    email: { type: "string", format: "email" },
    displayName: { type: "string", minLength: 5 },
    password: { type: "string", minLength: 6 },
    loginProvider: {
      type: "string",
      enum: ["google", "email", "github"],
      default: "email",
    },
    role: {
      type: "string",
      enum: ["buyer", "admin"],
      nullable: true,
    },
  },
};

export type UserFieldPayload = {
  email: string;
  displayName: string;
  password?: string;
  passwordHash?: string;
  loginProvider?: "google" | "email" | "github";
  role?: "buyer" | "admin";
};

export const createUserLoginSchema = {
  type: "object",
  required: ["email", "password"],
  properties: {
    email: { type: "string", format: "email" },
    password: { type: "string", minLength: 6 },
  },
};
