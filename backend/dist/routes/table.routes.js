"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
router.get("/", (_req, res) => {
    res.status(200).json({
        success: true,
        data: [],
        message: "Tables endpoint is live"
    });
});
router.get("/:id", (req, res) => {
    res.status(200).json({
        success: true,
        data: {
            id: req.params.id
        },
        message: "Single table endpoint is live"
    });
});
router.post("/", (req, res) => {
    res.status(201).json({
        success: true,
        message: "Create table endpoint is live",
        payload: req.body ?? null
    });
});
router.patch("/:id", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Update table endpoint is live",
        id: req.params.id,
        payload: req.body ?? null
    });
});
router.delete("/:id", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Delete table endpoint is live",
        id: req.params.id
    });
});
router.patch("/:id/position", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Update table position endpoint is live",
        id: req.params.id,
        payload: req.body ?? null
    });
});
exports.default = router;
