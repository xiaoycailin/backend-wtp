"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyPassword = exports.hashPassword = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const SALT_ROUNDS = 10;
const hashPassword = async (plain) => {
    return await bcrypt_1.default.hash(plain, SALT_ROUNDS);
};
exports.hashPassword = hashPassword;
const verifyPassword = async (plain, hashed) => {
    return await bcrypt_1.default.compare(plain, hashed);
};
exports.verifyPassword = verifyPassword;
