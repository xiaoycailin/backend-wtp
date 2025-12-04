"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugify = void 0;
const slugify = (text) => {
    return text
        .toString()
        .normalize("NFD") // hilangkan aksen/diacritics
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-") // selain huruf/angka = "-"
        .replace(/^-+|-+$/g, ""); // trim "-"
};
exports.slugify = slugify;
