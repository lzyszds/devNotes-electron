/**
 * 注册 tests/lib/ts-resolve-hooks.mjs。用法：
 *   node --import ./tests/lib/ts-resolve.mjs --test "tests/unit/**\/*.test.mjs"
 */
import { register } from 'node:module'

register(new URL('./ts-resolve-hooks.mjs', import.meta.url))
