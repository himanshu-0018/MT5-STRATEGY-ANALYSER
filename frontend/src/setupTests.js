/**
 * CRA loads this automatically before the test suites.
 * jsdom does not always expose TextDecoder/TextEncoder; the MT5 parser needs
 * them (the same globals browsers provide natively).
 */
import { TextDecoder, TextEncoder } from "util";

if (typeof global.TextDecoder === "undefined") global.TextDecoder = TextDecoder;
if (typeof global.TextEncoder === "undefined") global.TextEncoder = TextEncoder;
