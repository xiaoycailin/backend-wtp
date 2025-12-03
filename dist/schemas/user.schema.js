"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUserLoginSchema = exports.createUserSchema = void 0;
exports.createUserSchema = {
    type: 'object',
    required: ['email', 'displayName'],
    properties: {
        email: { type: 'string', format: 'email' },
        displayName: { type: 'string', minLength: 5 },
        password: { type: 'string', minLength: 6 },
        loginProvider: { type: 'string', enum: ['google', 'email', 'github'], default: 'google' },
        role: { type: 'string', enum: ['buyer', 'admin', 'seller'], nullable: true },
    },
};
exports.createUserLoginSchema = {
    type: 'object',
    required: ['email', 'password'],
    properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 6 },
    },
};
