"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = validate;
function validate(schema, target = 'body') {
    return (req, res, next) => {
        const result = schema.safeParse(req[target]);
        if (!result.success) {
            res.status(422).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Request validation failed',
                    details: result.error.flatten(),
                },
            });
            return;
        }
        // req.query is a getter-only property on IncomingMessage in Express 5.
        // Direct assignment throws "has only a getter". Shadow it on the instance
        // with a configurable own property so downstream code reads Zod-parsed data.
        Object.defineProperty(req, target, {
            value: result.data,
            writable: true,
            configurable: true,
        });
        next();
    };
}
//# sourceMappingURL=validate.js.map