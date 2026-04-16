"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
router.get("/board", (_req, res) => {
    res.status(200).json({
        success: true,
        data: [],
        message: "Table board endpoint is live"
    });
});
exports.default = router;
