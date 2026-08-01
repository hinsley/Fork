import { startWorkers } from './snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js';

let wasm;

let cachedUint8ArrayMemory0 = null;

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.buffer !== wasm.memory.buffer) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

let cachedTextDecoder = (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }) : undefined);

if (cachedTextDecoder) cachedTextDecoder.decode();

const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().slice(ptr, ptr + len));
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let WASM_VECTOR_LEN = 0;

const cachedTextEncoder = (typeof TextEncoder !== 'undefined' ? new TextEncoder() : undefined);

if (cachedTextEncoder) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    }
}

function passStringToWasm0(arg, malloc, realloc) {

    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }

    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedDataViewMemory0 = null;

function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer !== wasm.memory.buffer) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

let cachedFloat64ArrayMemory0 = null;

function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.buffer !== wasm.memory.buffer) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedUint32ArrayMemory0 = null;

function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.buffer !== wasm.memory.buffer) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}
/**
 * @returns {Promise<any>}
 */
export function init_fork_thread_pool() {
    const ret = wasm.init_fork_thread_pool();
    return ret;
}

/**
 * @param {number} num_threads
 * @returns {Promise<any>}
 */
export function initThreadPool(num_threads) {
    const ret = wasm.initThreadPool(num_threads);
    return ret;
}

/**
 * @param {number} receiver
 */
export function wbg_rayon_start_worker(receiver) {
    wasm.wbg_rayon_start_worker(receiver);
}

const WasmCodim1CurveExtensionRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmcodim1curveextensionrunner_free(ptr >>> 0, 1));

export class WasmCodim1CurveExtensionRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmCodim1CurveExtensionRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmcodim1curveextensionrunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmcodim1curveextensionrunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmcodim1curveextensionrunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_adaptation_report() {
        const ret = wasm.wasmcodim1curveextensionrunner_get_adaptation_report(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_result_with_report() {
        const ret = wasm.wasmcodim1curveextensionrunner_get_result_with_report(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} system_type
     * @param {number} map_iterations
     * @param {any} branch_val
     * @param {string} _parameter_name
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, system_type, map_iterations, branch_val, _parameter_name, settings_val, forward) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(system_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passStringToWasm0(_parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len5 = WASM_VECTOR_LEN;
        const ret = wasm.wasmcodim1curveextensionrunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, map_iterations, branch_val, ptr5, len5, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmCodim1CurveExtensionRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmcodim1curveextensionrunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmcodim1curveextensionrunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmCodim1CurveExtensionRunner.prototype[Symbol.dispose] = WasmCodim1CurveExtensionRunner.prototype.free;

const WasmContinuationExtensionRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmcontinuationextensionrunner_free(ptr >>> 0, 1));

export class WasmContinuationExtensionRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmContinuationExtensionRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmcontinuationextensionrunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmcontinuationextensionrunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmcontinuationextensionrunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_adaptation_report() {
        const ret = wasm.wasmcontinuationextensionrunner_get_adaptation_report(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_result_with_report() {
        const ret = wasm.wasmcontinuationextensionrunner_get_result_with_report(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_linear_solver_stats() {
        const ret = wasm.wasmcontinuationextensionrunner_get_linear_solver_stats(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} system_type
     * @param {number} map_iterations
     * @param {any} branch_val
     * @param {string} parameter_name
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, system_type, map_iterations, branch_val, parameter_name, settings_val, forward) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(system_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len5 = WASM_VECTOR_LEN;
        const ret = wasm.wasmcontinuationextensionrunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, map_iterations, branch_val, ptr5, len5, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmContinuationExtensionRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmcontinuationextensionrunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmcontinuationextensionrunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmContinuationExtensionRunner.prototype[Symbol.dispose] = WasmContinuationExtensionRunner.prototype.free;

const WasmCovariantLyapunovRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmcovariantlyapunovrunner_free(ptr >>> 0, 1));

export class WasmCovariantLyapunovRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmCovariantLyapunovRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmcovariantlyapunovrunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmcovariantlyapunovrunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmcovariantlyapunovrunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} solver_name
     * @param {Float64Array} initial_state
     * @param {number} initial_time
     * @param {number} dt
     * @param {number} qr_stride
     * @param {number} window_steps
     * @param {number} forward_transient
     * @param {number} backward_transient
     */
    constructor(equations, params, param_names, var_names, solver_name, initial_state, initial_time, dt, qr_stride, window_steps, forward_transient, backward_transient) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(solver_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF64ToWasm0(initial_state, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ret = wasm.wasmcovariantlyapunovrunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, initial_time, dt, qr_stride, window_steps, forward_transient, backward_transient);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmCovariantLyapunovRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmcovariantlyapunovrunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmcovariantlyapunovrunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmCovariantLyapunovRunner.prototype[Symbol.dispose] = WasmCovariantLyapunovRunner.prototype.free;

const WasmCycleManifold2DRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmcyclemanifold2drunner_free(ptr >>> 0, 1));

export class WasmCycleManifold2DRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmCycleManifold2DRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmcyclemanifold2drunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmcyclemanifold2drunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmcyclemanifold2drunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} system_type
     * @param {Float64Array} cycle_state
     * @param {number} ntst
     * @param {number} ncol
     * @param {any} floquet_multipliers_val
     * @param {any} settings_val
     */
    constructor(equations, params, param_names, var_names, system_type, cycle_state, ntst, ncol, floquet_multipliers_val, settings_val) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(system_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF64ToWasm0(cycle_state, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ret = wasm.wasmcyclemanifold2drunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ntst, ncol, floquet_multipliers_val, settings_val);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmCycleManifold2DRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmcyclemanifold2drunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} _batch_size
     * @returns {any}
     */
    run_steps(_batch_size) {
        const ret = wasm.wasmcyclemanifold2drunner_run_steps(this.__wbg_ptr, _batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmCycleManifold2DRunner.prototype[Symbol.dispose] = WasmCycleManifold2DRunner.prototype.free;

const WasmEqManifold1DExtensionRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmeqmanifold1dextensionrunner_free(ptr >>> 0, 1));

export class WasmEqManifold1DExtensionRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmEqManifold1DExtensionRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmeqmanifold1dextensionrunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmeqmanifold1dextensionrunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmeqmanifold1dextensionrunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} system_type
     * @param {number} map_iterations
     * @param {any} branch_val
     * @param {any} settings_val
     * @param {Float64Array} periods
     */
    constructor(equations, params, param_names, var_names, system_type, map_iterations, branch_val, settings_val, periods) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(system_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF64ToWasm0(periods, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ret = wasm.wasmeqmanifold1dextensionrunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, map_iterations, branch_val, settings_val, ptr5, len5);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmEqManifold1DExtensionRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmeqmanifold1dextensionrunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmeqmanifold1dextensionrunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmEqManifold1DExtensionRunner.prototype[Symbol.dispose] = WasmEqManifold1DExtensionRunner.prototype.free;

const WasmEqManifold1DGroupExtensionRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmeqmanifold1dgroupextensionrunner_free(ptr >>> 0, 1));

export class WasmEqManifold1DGroupExtensionRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmEqManifold1DGroupExtensionRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmeqmanifold1dgroupextensionrunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmeqmanifold1dgroupextensionrunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmeqmanifold1dgroupextensionrunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} system_type
     * @param {number} map_iterations
     * @param {any} branches_val
     * @param {any} settings_val
     * @param {Float64Array} periods
     */
    constructor(equations, params, param_names, var_names, system_type, map_iterations, branches_val, settings_val, periods) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(system_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF64ToWasm0(periods, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ret = wasm.wasmeqmanifold1dgroupextensionrunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, map_iterations, branches_val, settings_val, ptr5, len5);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmEqManifold1DGroupExtensionRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmeqmanifold1dgroupextensionrunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmeqmanifold1dgroupextensionrunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmEqManifold1DGroupExtensionRunner.prototype[Symbol.dispose] = WasmEqManifold1DGroupExtensionRunner.prototype.free;

const WasmEqManifold1DRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmeqmanifold1drunner_free(ptr >>> 0, 1));

export class WasmEqManifold1DRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmEqManifold1DRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmeqmanifold1drunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmeqmanifold1drunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmeqmanifold1drunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} system_type
     * @param {number} map_iterations
     * @param {Float64Array} equilibrium_state
     * @param {any} settings_val
     * @param {Float64Array} periods
     */
    constructor(equations, params, param_names, var_names, system_type, map_iterations, equilibrium_state, settings_val, periods) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(system_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF64ToWasm0(equilibrium_state, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passArrayF64ToWasm0(periods, wasm.__wbindgen_malloc);
        const len6 = WASM_VECTOR_LEN;
        const ret = wasm.wasmeqmanifold1drunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, map_iterations, ptr5, len5, settings_val, ptr6, len6);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmEqManifold1DRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmeqmanifold1dgroupextensionrunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmeqmanifold1drunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmEqManifold1DRunner.prototype[Symbol.dispose] = WasmEqManifold1DRunner.prototype.free;

const WasmEqManifold2DRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmeqmanifold2drunner_free(ptr >>> 0, 1));

export class WasmEqManifold2DRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmEqManifold2DRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmeqmanifold2drunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmeqmanifold2drunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmeqmanifold2drunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} system_type
     * @param {Float64Array} equilibrium_state
     * @param {any} settings_val
     */
    constructor(equations, params, param_names, var_names, system_type, equilibrium_state, settings_val) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(system_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF64ToWasm0(equilibrium_state, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ret = wasm.wasmeqmanifold2drunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, settings_val);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmEqManifold2DRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmcyclemanifold2drunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} _batch_size
     * @returns {any}
     */
    run_steps(_batch_size) {
        const ret = wasm.wasmeqmanifold2drunner_run_steps(this.__wbg_ptr, _batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmEqManifold2DRunner.prototype[Symbol.dispose] = WasmEqManifold2DRunner.prototype.free;

const WasmEquilibriumRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmequilibriumrunner_free(ptr >>> 0, 1));
/**
 * WASM-exported runner for stepped equilibrium continuation.
 * Allows progress reporting by running batches of steps at a time.
 */
export class WasmEquilibriumRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmEquilibriumRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmequilibriumrunner_free(ptr, 0);
    }
    /**
     * Get the final branch result.
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmequilibriumrunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Get progress information.
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmequilibriumrunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Create a new stepped equilibrium continuation runner.
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} system_type
     * @param {number} map_iterations
     * @param {Float64Array} equilibrium_state
     * @param {string} parameter_name
     * @param {any} settings_val
     * @param {boolean} forward
     * @param {Float64Array} periods
     */
    constructor(equations, params, param_names, var_names, system_type, map_iterations, equilibrium_state, parameter_name, settings_val, forward, periods) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(system_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF64ToWasm0(equilibrium_state, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len6 = WASM_VECTOR_LEN;
        const ptr7 = passArrayF64ToWasm0(periods, wasm.__wbindgen_malloc);
        const len7 = WASM_VECTOR_LEN;
        const ret = wasm.wasmequilibriumrunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, map_iterations, ptr5, len5, ptr6, len6, settings_val, forward, ptr7, len7);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmEquilibriumRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Check if the continuation is complete.
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmequilibriumrunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Run a batch of continuation steps and return progress.
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmequilibriumrunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmEquilibriumRunner.prototype[Symbol.dispose] = WasmEquilibriumRunner.prototype.free;

const WasmEquilibriumSolverRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmequilibriumsolverrunner_free(ptr >>> 0, 1));

export class WasmEquilibriumSolverRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmEquilibriumSolverRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmequilibriumsolverrunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmequilibriumsolverrunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmequilibriumsolverrunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} flattened_roots
     * @param {number} exponent
     * @param {number} shift
     */
    set_deflation(flattened_roots, exponent, shift) {
        const ptr0 = passArrayF64ToWasm0(flattened_roots, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmequilibriumsolverrunner_set_deflation(this.__wbg_ptr, ptr0, len0, exponent, shift);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {Float64Array} flattened_roots
     * @param {Float64Array} exponents
     * @param {Float64Array} shifts
     */
    set_deflation_targets(flattened_roots, exponents, shifts) {
        const ptr0 = passArrayF64ToWasm0(flattened_roots, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(exponents, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(shifts, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmequilibriumsolverrunner_set_deflation_targets(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} system_type
     * @param {number} map_iterations
     * @param {Float64Array} initial_guess
     * @param {number} max_steps
     * @param {number} damping
     * @param {Float64Array} periods
     */
    constructor(equations, params, param_names, var_names, system_type, map_iterations, initial_guess, max_steps, damping, periods) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(system_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF64ToWasm0(initial_guess, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passArrayF64ToWasm0(periods, wasm.__wbindgen_malloc);
        const len6 = WASM_VECTOR_LEN;
        const ret = wasm.wasmequilibriumsolverrunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, map_iterations, ptr5, len5, max_steps, damping, ptr6, len6);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmEquilibriumSolverRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmequilibriumsolverrunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmequilibriumsolverrunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmEquilibriumSolverRunner.prototype[Symbol.dispose] = WasmEquilibriumSolverRunner.prototype.free;

const WasmExpansionEntropyRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmexpansionentropyrunner_free(ptr >>> 0, 1));

export class WasmExpansionEntropyRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmExpansionEntropyRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmexpansionentropyrunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmexpansionentropyrunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmexpansionentropyrunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} solver_name
     * @param {Float64Array} minimums
     * @param {Float64Array} maximums
     * @param {Uint32Array} resolution
     * @param {number} initial_time
     * @param {number} steps
     * @param {number} dt
     * @param {number} checkpoint_stride
     * @param {number} stabilization_stride
     */
    constructor(equations, params, param_names, var_names, solver_name, minimums, maximums, resolution, initial_time, steps, dt, checkpoint_stride, stabilization_stride) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(solver_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF64ToWasm0(minimums, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passArrayF64ToWasm0(maximums, wasm.__wbindgen_malloc);
        const len6 = WASM_VECTOR_LEN;
        const ptr7 = passArray32ToWasm0(resolution, wasm.__wbindgen_malloc);
        const len7 = WASM_VECTOR_LEN;
        const ret = wasm.wasmexpansionentropyrunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, ptr7, len7, initial_time, steps, dt, checkpoint_stride, stabilization_stride);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmExpansionEntropyRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    cancel() {
        const ret = wasm.wasmexpansionentropyrunner_cancel(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {any}
     */
    advance() {
        const ret = wasm.wasmexpansionentropyrunner_advance(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {number} _batch_size
     * @returns {any}
     */
    run_steps(_batch_size) {
        const ret = wasm.wasmexpansionentropyrunner_run_steps(this.__wbg_ptr, _batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmExpansionEntropyRunner.prototype[Symbol.dispose] = WasmExpansionEntropyRunner.prototype.free;

const WasmFoldCurveRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmfoldcurverunner_free(ptr >>> 0, 1));

export class WasmFoldCurveRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmFoldCurveRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmfoldcurverunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmfoldcurverunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmfoldcurverunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} system_type
     * @param {number} map_iterations
     * @param {Float64Array} fold_state
     * @param {string} param1_name
     * @param {number} param1_value
     * @param {string} param2_name
     * @param {number} param2_value
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, system_type, map_iterations, fold_state, param1_name, param1_value, param2_name, param2_value, settings_val, forward) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(system_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF64ToWasm0(fold_state, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passStringToWasm0(param1_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len6 = WASM_VECTOR_LEN;
        const ptr7 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len7 = WASM_VECTOR_LEN;
        const ret = wasm.wasmfoldcurverunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, map_iterations, ptr5, len5, ptr6, len6, param1_value, ptr7, len7, param2_value, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmFoldCurveRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmfoldcurverunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmfoldcurverunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmFoldCurveRunner.prototype[Symbol.dispose] = WasmFoldCurveRunner.prototype.free;

const WasmForcedResponseRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmforcedresponserunner_free(ptr >>> 0, 1));

export class WasmForcedResponseRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmForcedResponseRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmforcedresponserunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmforcedresponserunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmforcedresponserunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} solver_name
     * @param {string} system_type
     * @param {string} period_expression
     * @param {number} iteration_period
     * @param {number} phase
     * @param {number} response_multiple
     * @param {number} steps_per_forcing_period
     * @param {Float64Array} initial_state
     * @param {string} parameter_name
     * @param {any} settings_value
     * @param {boolean} forward
     * @param {Float64Array} periods
     */
    constructor(equations, params, param_names, var_names, solver_name, system_type, period_expression, iteration_period, phase, response_multiple, steps_per_forcing_period, initial_state, parameter_name, settings_value, forward, periods) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(solver_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passStringToWasm0(system_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passStringToWasm0(period_expression, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len6 = WASM_VECTOR_LEN;
        const ptr7 = passArrayF64ToWasm0(initial_state, wasm.__wbindgen_malloc);
        const len7 = WASM_VECTOR_LEN;
        const ptr8 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len8 = WASM_VECTOR_LEN;
        const ptr9 = passArrayF64ToWasm0(periods, wasm.__wbindgen_malloc);
        const len9 = WASM_VECTOR_LEN;
        const ret = wasm.wasmforcedresponserunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, iteration_period, phase, response_multiple, steps_per_forcing_period, ptr7, len7, ptr8, len8, settings_value, forward, ptr9, len9);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmForcedResponseRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmforcedresponserunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmforcedresponserunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmForcedResponseRunner.prototype[Symbol.dispose] = WasmForcedResponseRunner.prototype.free;

const WasmHeteroclinicRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmheteroclinicrunner_free(ptr >>> 0, 1));

export class WasmHeteroclinicRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmHeteroclinicRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmheteroclinicrunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmheteroclinicrunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmheteroclinicrunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {any} setup_val
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, setup_val, settings_val, forward) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.wasmheteroclinicrunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, setup_val, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmHeteroclinicRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmheteroclinicrunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmheteroclinicrunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmHeteroclinicRunner.prototype[Symbol.dispose] = WasmHeteroclinicRunner.prototype.free;

const WasmHeteroclinicShootingRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmheteroclinicshootingrunner_free(ptr >>> 0, 1));

export class WasmHeteroclinicShootingRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmHeteroclinicShootingRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmheteroclinicshootingrunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmheteroclinicshootingrunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmheteroclinicshootingrunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {any} setup_val
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, setup_val, settings_val, forward) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.wasmheteroclinicshootingrunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, setup_val, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmHeteroclinicShootingRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmheteroclinicshootingrunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmheteroclinicshootingrunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmHeteroclinicShootingRunner.prototype[Symbol.dispose] = WasmHeteroclinicShootingRunner.prototype.free;

const WasmHomoclinicRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmhomoclinicrunner_free(ptr >>> 0, 1));

export class WasmHomoclinicRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmHomoclinicRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmhomoclinicrunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmhomoclinicrunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmhomoclinicrunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {any} setup_val
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, setup_val, settings_val, forward) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.wasmhomoclinicrunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, setup_val, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmHomoclinicRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmhomoclinicrunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmhomoclinicrunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmHomoclinicRunner.prototype[Symbol.dispose] = WasmHomoclinicRunner.prototype.free;

const WasmHomoclinicShootingRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmhomoclinicshootingrunner_free(ptr >>> 0, 1));

export class WasmHomoclinicShootingRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmHomoclinicShootingRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmhomoclinicshootingrunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmhomoclinicshootingrunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmhomoclinicshootingrunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {any} setup_val
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, setup_val, settings_val, forward) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.wasmhomoclinicshootingrunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, setup_val, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmHomoclinicShootingRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmhomoclinicshootingrunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmhomoclinicshootingrunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmHomoclinicShootingRunner.prototype[Symbol.dispose] = WasmHomoclinicShootingRunner.prototype.free;

const WasmHomotopySaddleRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmhomotopysaddlerunner_free(ptr >>> 0, 1));

export class WasmHomotopySaddleRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmHomotopySaddleRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmhomotopysaddlerunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmhomotopysaddlerunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmhomotopysaddlerunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {any} setup_val
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, setup_val, settings_val, forward) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.wasmhomotopysaddlerunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, setup_val, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmHomotopySaddleRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmhomotopysaddlerunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} _batch_size
     * @returns {any}
     */
    run_steps(_batch_size) {
        const ret = wasm.wasmhomotopysaddlerunner_run_steps(this.__wbg_ptr, _batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmHomotopySaddleRunner.prototype[Symbol.dispose] = WasmHomotopySaddleRunner.prototype.free;

const WasmHopfCurveRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmhopfcurverunner_free(ptr >>> 0, 1));

export class WasmHopfCurveRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmHopfCurveRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmhopfcurverunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmhopfcurverunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmhopfcurverunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} system_type
     * @param {number} map_iterations
     * @param {Float64Array} hopf_state
     * @param {number} hopf_omega
     * @param {string} param1_name
     * @param {number} param1_value
     * @param {string} param2_name
     * @param {number} param2_value
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, system_type, map_iterations, hopf_state, hopf_omega, param1_name, param1_value, param2_name, param2_value, settings_val, forward) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(system_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF64ToWasm0(hopf_state, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passStringToWasm0(param1_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len6 = WASM_VECTOR_LEN;
        const ptr7 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len7 = WASM_VECTOR_LEN;
        const ret = wasm.wasmhopfcurverunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, map_iterations, ptr5, len5, hopf_omega, ptr6, len6, param1_value, ptr7, len7, param2_value, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmHopfCurveRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmhopfcurverunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmhopfcurverunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmHopfCurveRunner.prototype[Symbol.dispose] = WasmHopfCurveRunner.prototype.free;

const WasmIsoperiodicCurveRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmisoperiodiccurverunner_free(ptr >>> 0, 1));

export class WasmIsoperiodicCurveRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmIsoperiodicCurveRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmisoperiodiccurverunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmisoperiodiccurverunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmisoperiodiccurverunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_adaptation_report() {
        const ret = wasm.wasmisoperiodiccurverunner_get_adaptation_report(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_result_with_report() {
        const ret = wasm.wasmisoperiodiccurverunner_get_result_with_report(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {Float64Array} lc_state
     * @param {number} period
     * @param {string} param1_name
     * @param {number} param1_value
     * @param {string} param2_name
     * @param {number} param2_value
     * @param {number} ntst
     * @param {number} ncol
     * @param {Float64Array} normalized_mesh
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, lc_state, period, param1_name, param1_value, param2_name, param2_value, ntst, ncol, normalized_mesh, settings_val, forward) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArrayF64ToWasm0(lc_state, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passStringToWasm0(param1_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len6 = WASM_VECTOR_LEN;
        const ptr7 = passArrayF64ToWasm0(normalized_mesh, wasm.__wbindgen_malloc);
        const len7 = WASM_VECTOR_LEN;
        const ret = wasm.wasmisoperiodiccurverunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, period, ptr5, len5, param1_value, ptr6, len6, param2_value, ntst, ncol, ptr7, len7, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmIsoperiodicCurveRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmisoperiodiccurverunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmisoperiodiccurverunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmIsoperiodicCurveRunner.prototype[Symbol.dispose] = WasmIsoperiodicCurveRunner.prototype.free;

const WasmLPCCurveRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmlpccurverunner_free(ptr >>> 0, 1));

export class WasmLPCCurveRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmLPCCurveRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmlpccurverunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmlpccurverunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmlpccurverunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_adaptation_report() {
        const ret = wasm.wasmlpccurverunner_get_adaptation_report(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_result_with_report() {
        const ret = wasm.wasmlpccurverunner_get_result_with_report(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {Float64Array} lc_state
     * @param {number} period
     * @param {string} param1_name
     * @param {number} param1_value
     * @param {string} param2_name
     * @param {number} param2_value
     * @param {number} ntst
     * @param {number} ncol
     * @param {Float64Array} normalized_mesh
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, lc_state, period, param1_name, param1_value, param2_name, param2_value, ntst, ncol, normalized_mesh, settings_val, forward) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArrayF64ToWasm0(lc_state, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passStringToWasm0(param1_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len6 = WASM_VECTOR_LEN;
        const ptr7 = passArrayF64ToWasm0(normalized_mesh, wasm.__wbindgen_malloc);
        const len7 = WASM_VECTOR_LEN;
        const ret = wasm.wasmlpccurverunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, period, ptr5, len5, param1_value, ptr6, len6, param2_value, ntst, ncol, ptr7, len7, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmLPCCurveRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmlpccurverunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmlpccurverunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmLPCCurveRunner.prototype[Symbol.dispose] = WasmLPCCurveRunner.prototype.free;

const WasmLimitCycleRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmlimitcyclerunner_free(ptr >>> 0, 1));

export class WasmLimitCycleRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmLimitCycleRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmlimitcyclerunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmlimitcyclerunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmlimitcyclerunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_adaptation_report() {
        const ret = wasm.wasmlimitcyclerunner_get_adaptation_report(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_result_with_report() {
        const ret = wasm.wasmlimitcyclerunner_get_result_with_report(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_linear_solver_stats() {
        const ret = wasm.wasmlimitcyclerunner_get_linear_solver_stats(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} system_type
     * @param {any} setup_val
     * @param {string} parameter_name
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, system_type, setup_val, parameter_name, settings_val, forward) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(system_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len5 = WASM_VECTOR_LEN;
        const ret = wasm.wasmlimitcyclerunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, setup_val, ptr5, len5, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmLimitCycleRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmlimitcyclerunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmlimitcyclerunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmLimitCycleRunner.prototype[Symbol.dispose] = WasmLimitCycleRunner.prototype.free;

const WasmLyapunovRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmlyapunovrunner_free(ptr >>> 0, 1));

export class WasmLyapunovRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmLyapunovRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmlyapunovrunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmlyapunovrunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmlyapunovrunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} solver_name
     * @param {Float64Array} initial_state
     * @param {number} initial_time
     * @param {number} steps
     * @param {number} dt
     * @param {number} qr_stride
     */
    constructor(equations, params, param_names, var_names, solver_name, initial_state, initial_time, steps, dt, qr_stride) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(solver_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF64ToWasm0(initial_state, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ret = wasm.wasmlyapunovrunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, initial_time, steps, dt, qr_stride);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmLyapunovRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmlyapunovrunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmlyapunovrunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmLyapunovRunner.prototype[Symbol.dispose] = WasmLyapunovRunner.prototype.free;

const WasmManifold2DExtensionRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmmanifold2dextensionrunner_free(ptr >>> 0, 1));

export class WasmManifold2DExtensionRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmManifold2DExtensionRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmmanifold2dextensionrunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmmanifold2dextensionrunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmmanifold2dextensionrunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} system_type
     * @param {any} branch_val
     * @param {any} settings_val
     */
    constructor(equations, params, param_names, var_names, system_type, branch_val, settings_val) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(system_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ret = wasm.wasmmanifold2dextensionrunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, branch_val, settings_val);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmManifold2DExtensionRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmmanifold2dextensionrunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} _batch_size
     * @returns {any}
     */
    run_steps(_batch_size) {
        const ret = wasm.wasmmanifold2dextensionrunner_run_steps(this.__wbg_ptr, _batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmManifold2DExtensionRunner.prototype[Symbol.dispose] = WasmManifold2DExtensionRunner.prototype.free;

const WasmNSCurveRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmnscurverunner_free(ptr >>> 0, 1));

export class WasmNSCurveRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmNSCurveRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmnscurverunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmnscurverunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmnscurverunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_adaptation_report() {
        const ret = wasm.wasmnscurverunner_get_adaptation_report(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_result_with_report() {
        const ret = wasm.wasmnscurverunner_get_result_with_report(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {Float64Array} lc_state
     * @param {number} period
     * @param {string} param1_name
     * @param {number} param1_value
     * @param {string} param2_name
     * @param {number} param2_value
     * @param {number} initial_k
     * @param {number} ntst
     * @param {number} ncol
     * @param {Float64Array} normalized_mesh
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, lc_state, period, param1_name, param1_value, param2_name, param2_value, initial_k, ntst, ncol, normalized_mesh, settings_val, forward) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArrayF64ToWasm0(lc_state, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passStringToWasm0(param1_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len6 = WASM_VECTOR_LEN;
        const ptr7 = passArrayF64ToWasm0(normalized_mesh, wasm.__wbindgen_malloc);
        const len7 = WASM_VECTOR_LEN;
        const ret = wasm.wasmnscurverunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, period, ptr5, len5, param1_value, ptr6, len6, param2_value, initial_k, ntst, ncol, ptr7, len7, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmNSCurveRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmnscurverunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmnscurverunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmNSCurveRunner.prototype[Symbol.dispose] = WasmNSCurveRunner.prototype.free;

const WasmPDCurveRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmpdcurverunner_free(ptr >>> 0, 1));

export class WasmPDCurveRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmPDCurveRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmpdcurverunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmpdcurverunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmpdcurverunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_adaptation_report() {
        const ret = wasm.wasmpdcurverunner_get_adaptation_report(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_result_with_report() {
        const ret = wasm.wasmpdcurverunner_get_result_with_report(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {Float64Array} lc_state
     * @param {number} period
     * @param {string} param1_name
     * @param {number} param1_value
     * @param {string} param2_name
     * @param {number} param2_value
     * @param {number} ntst
     * @param {number} ncol
     * @param {Float64Array} normalized_mesh
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, lc_state, period, param1_name, param1_value, param2_name, param2_value, ntst, ncol, normalized_mesh, settings_val, forward) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArrayF64ToWasm0(lc_state, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passStringToWasm0(param1_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len6 = WASM_VECTOR_LEN;
        const ptr7 = passArrayF64ToWasm0(normalized_mesh, wasm.__wbindgen_malloc);
        const len7 = WASM_VECTOR_LEN;
        const ret = wasm.wasmpdcurverunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, period, ptr5, len5, param1_value, ptr6, len6, param2_value, ntst, ncol, ptr7, len7, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmPDCurveRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    is_done() {
        const ret = wasm.wasmpdcurverunner_is_done(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} batch_size
     * @returns {any}
     */
    run_steps(batch_size) {
        const ret = wasm.wasmpdcurverunner_run_steps(this.__wbg_ptr, batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmPDCurveRunner.prototype[Symbol.dispose] = WasmPDCurveRunner.prototype.free;

const WasmSystemFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmsystem_free(ptr >>> 0, 1));

export class WasmSystem {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmSystemFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmsystem_free(ptr, 0);
    }
    /**
     * @param {Float64Array} periods
     */
    set_periods(periods) {
        const ptr0 = passArrayF64ToWasm0(periods, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmsystem_set_periods(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {boolean}
     */
    uses_context() {
        const ret = wasm.wasmsystem_uses_context(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {string | undefined}
     */
    context_symbol() {
        const ret = wasm.wasmsystem_context_symbol(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * @param {string} expression
     * @param {number} level
     * @param {Uint32Array} axis_indices
     * @param {Float64Array} axis_mins
     * @param {Float64Array} axis_maxs
     * @param {Uint32Array} axis_samples
     * @param {Float64Array} frozen_state
     * @param {string[]} var_names
     * @param {string[]} param_names
     * @returns {any}
     */
    compute_isocline(expression, level, axis_indices, axis_mins, axis_maxs, axis_samples, frozen_state, var_names, param_names) {
        const ptr0 = passStringToWasm0(expression, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(axis_indices, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(axis_mins, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayF64ToWasm0(axis_maxs, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArray32ToWasm0(axis_samples, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF64ToWasm0(frozen_state, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len6 = WASM_VECTOR_LEN;
        const ptr7 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len7 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_isocline(this.__wbg_ptr, ptr0, len0, level, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, ptr7, len7);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {Float64Array}
     */
    compute_jacobian() {
        const ret = wasm.wasmsystem_compute_jacobian(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} solver_name
     * @param {string} system_type
     */
    constructor(equations, params, param_names, var_names, solver_name, system_type) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(solver_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passStringToWasm0(system_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len5 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmSystemFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} dt
     */
    step(dt) {
        wasm.wasmsystem_step(this.__wbg_ptr, dt);
    }
    /**
     * @returns {number}
     */
    get_t() {
        const ret = wasm.wasmsystem_get_t(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} t
     */
    set_t(t) {
        wasm.wasmsystem_set_t(this.__wbg_ptr, t);
    }
    /**
     * @returns {Float64Array}
     */
    get_state() {
        const ret = wasm.wasmsystem_get_state(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} state
     */
    set_state(state) {
        const ptr0 = passArrayF64ToWasm0(state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmsystem_set_state(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Compute local normal-form coefficients at a refined map bifurcation.
     *
     * `normal_form_type` accepts `branchPoint`, `periodDoubling`, or
     * `neimarkSacker`. The returned object is tagged by its `type` field and
     * includes coefficient and conditioning diagnostics.
     * @param {Float64Array} state
     * @param {number} param_index
     * @param {number} param_value
     * @param {number} map_iterations
     * @param {string} normal_form_type
     * @returns {any}
     */
    compute_map_normal_form(state, param_index, param_value, map_iterations, normal_form_type) {
        const ptr0 = passArrayF64ToWasm0(state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(normal_form_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_map_normal_form(this.__wbg_ptr, ptr0, len0, param_index, param_value, map_iterations, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Produce corrected Hopf-Hopf switches to both orientations of both Hopf
     * curves and to both periodic-orbit Neimark-Sacker curves.
     * @param {Float64Array} state
     * @param {number} param1_index
     * @param {number} param2_index
     * @param {number} param1_value
     * @param {number} param2_value
     * @param {number} source_frequency
     * @param {number} curve_perturbation
     * @param {number} cycle_amplitude
     * @param {number} ntst
     * @param {number} ncol
     * @param {number} tolerance
     * @returns {any}
     */
    switch_from_hopf_hopf(state, param1_index, param2_index, param1_value, param2_value, source_frequency, curve_perturbation, cycle_amplitude, ntst, ncol, tolerance) {
        const ptr0 = passArrayF64ToWasm0(state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_switch_from_hopf_hopf(this.__wbg_ptr, ptr0, len0, param1_index, param2_index, param1_value, param2_value, source_frequency, curve_perturbation, cycle_amplitude, ntst, ncol, tolerance);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Produce corrected Zero-Hopf switches to both fold/Hopf orientations
     * and, when the coefficient sign condition permits it, the periodic-orbit
     * Neimark-Sacker curve.
     * @param {Float64Array} state
     * @param {number} param1_index
     * @param {number} param2_index
     * @param {number} param1_value
     * @param {number} param2_value
     * @param {number} frequency
     * @param {number} curve_perturbation
     * @param {number} cycle_amplitude
     * @param {number} ntst
     * @param {number} ncol
     * @param {number} tolerance
     * @returns {any}
     */
    switch_from_zero_hopf(state, param1_index, param2_index, param1_value, param2_value, frequency, curve_perturbation, cycle_amplitude, ntst, ncol, tolerance) {
        const ptr0 = passArrayF64ToWasm0(state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_switch_from_zero_hopf(this.__wbg_ptr, ptr0, len0, param1_index, param2_index, param1_value, param2_value, frequency, curve_perturbation, cycle_amplitude, ntst, ncol, tolerance);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Compute detailed, serializable nonresonant Hopf-Hopf coefficients and
     * both NS unfolding predictors.
     * @param {Float64Array} state
     * @param {number} param1_index
     * @param {number} param2_index
     * @param {number} param1_value
     * @param {number} param2_value
     * @param {number} source_frequency
     * @returns {any}
     */
    compute_hopf_hopf_normal_form(state, param1_index, param2_index, param1_value, param2_value, source_frequency) {
        const ptr0 = passArrayF64ToWasm0(state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_hopf_hopf_normal_form(this.__wbg_ptr, ptr0, len0, param1_index, param2_index, param1_value, param2_value, source_frequency);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Compute detailed, serializable Zero-Hopf coefficients and numerical
     * conditioning diagnostics at a refined equilibrium codimension-two
     * point.
     * @param {Float64Array} state
     * @param {number} param1_index
     * @param {number} param2_index
     * @param {number} param1_value
     * @param {number} param2_value
     * @param {number} frequency
     * @returns {any}
     */
    compute_zero_hopf_normal_form(state, param1_index, param2_index, param1_value, param2_value, frequency) {
        const ptr0 = passArrayF64ToWasm0(state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_zero_hopf_normal_form(this.__wbg_ptr, ptr0, len0, param1_index, param2_index, param1_value, param2_value, frequency);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Construct a collocation predictor on the periodic branch emanating
     * from a generic periodic branch point.
     * @param {any} setup_val
     * @param {number} param_index
     * @param {any} normal_form_val
     * @param {number} amplitude
     * @returns {any}
     */
    switch_periodic_orbit_branch(setup_val, param_index, normal_form_val, amplitude) {
        const ret = wasm.wasmsystem_switch_periodic_orbit_branch(this.__wbg_ptr, setup_val, param_index, normal_form_val, amplitude);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Compute a Poincare-return-map normal form at a corrected limit cycle.
     *
     * The returned tagged object contains PD, NS, or generic `+1`
     * coefficients and residual/conditioning diagnostics.  A `+1` form is
     * explicitly classified as either an LPC or a generic periodic branch
     * point.
     * @param {any} setup_val
     * @param {number} param_index
     * @param {string} normal_form_type
     * @returns {any}
     */
    compute_periodic_orbit_normal_form(setup_val, param_index, normal_form_type) {
        const ptr0 = passStringToWasm0(normal_form_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_periodic_orbit_normal_form(this.__wbg_ptr, setup_val, param_index, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} point_state
     * @param {number} source_intervals
     * @param {boolean} source_free_time
     * @param {boolean} source_free_eps0
     * @param {boolean} source_free_eps1
     * @param {number} source_fixed_time
     * @param {number} source_fixed_eps0
     * @param {number} source_fixed_eps1
     * @param {string} param1_name
     * @param {string} param2_name
     * @param {number} target_intervals
     * @param {number} integration_steps_per_segment
     * @param {boolean} free_time
     * @param {boolean} free_eps0
     * @param {boolean} free_eps1
     * @returns {any}
     */
    init_homoclinic_shooting_from_shooting(point_state, source_intervals, source_free_time, source_free_eps0, source_free_eps1, source_fixed_time, source_fixed_eps0, source_fixed_eps1, param1_name, param2_name, target_intervals, integration_steps_per_segment, free_time, free_eps0, free_eps1) {
        const ptr0 = passArrayF64ToWasm0(point_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(param1_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_init_homoclinic_shooting_from_shooting(this.__wbg_ptr, ptr0, len0, source_intervals, source_free_time, source_free_eps0, source_free_eps1, source_fixed_time, source_fixed_eps0, source_fixed_eps1, ptr1, len1, ptr2, len2, target_intervals, integration_steps_per_segment, free_time, free_eps0, free_eps1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Blocking standard-shooting continuation, retained for CLI compatibility.
     * @param {any} setup_val
     * @param {any} settings_val
     * @param {boolean} forward
     * @returns {any}
     */
    compute_homoclinic_shooting_continuation(setup_val, settings_val, forward) {
        const ret = wasm.wasmsystem_compute_homoclinic_shooting_continuation(this.__wbg_ptr, setup_val, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Convert any existing collocation homoclinic seed (including large-cycle
     * and BT predictors) into standard single/multiple-shooting nodes.
     * @param {any} setup_val
     * @param {number} intervals
     * @param {number} integration_steps_per_segment
     * @returns {any}
     */
    init_homoclinic_shooting_from_collocation(setup_val, intervals, integration_steps_per_segment) {
        const ret = wasm.wasmsystem_init_homoclinic_shooting_from_collocation(this.__wbg_ptr, setup_val, intervals, integration_steps_per_segment);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Compute the generic `+1` normal form and construct its secondary-cycle
     * predictor directly from a saved branch point.
     * @param {Float64Array} packed_state
     * @param {number} param_index
     * @param {number} param_value
     * @param {number} collocation_degree
     * @param {Float64Array} normalized_mesh
     * @param {number} amplitude
     * @returns {any}
     */
    switch_periodic_branch_from_packed_state(packed_state, param_index, param_value, collocation_degree, normalized_mesh, amplitude) {
        const ptr0 = passArrayF64ToWasm0(packed_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(normalized_mesh, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_switch_periodic_branch_from_packed_state(this.__wbg_ptr, ptr0, len0, param_index, param_value, collocation_degree, ptr1, len1, amplitude);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Compute a periodic-orbit normal form directly from the full persisted
     * collocation state.  The exact saved mesh is mandatory; the setup and
     * phase direction are reconstructed inside Rust.
     * @param {Float64Array} packed_state
     * @param {number} param_index
     * @param {number} param_value
     * @param {number} collocation_degree
     * @param {Float64Array} normalized_mesh
     * @param {string} normal_form_type
     * @returns {any}
     */
    compute_periodic_normal_form_from_packed_state(packed_state, param_index, param_value, collocation_degree, normalized_mesh, normal_form_type) {
        const ptr0 = passArrayF64ToWasm0(packed_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(normalized_mesh, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(normal_form_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_periodic_normal_form_from_packed_state(this.__wbg_ptr, ptr0, len0, param_index, param_value, collocation_degree, ptr1, len1, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Blocking entry point retained for the Node CLI.
     * @param {any} setup_val
     * @param {any} settings_val
     * @param {boolean} forward
     * @returns {any}
     */
    compute_heteroclinic_shooting_continuation(setup_val, settings_val, forward) {
        const ret = wasm.wasmsystem_compute_heteroclinic_shooting_continuation(this.__wbg_ptr, setup_val, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {any} setup_val
     * @param {number} intervals
     * @param {number} integration_steps_per_segment
     * @returns {any}
     */
    init_heteroclinic_shooting_from_collocation(setup_val, intervals, integration_steps_per_segment) {
        const ret = wasm.wasmsystem_init_heteroclinic_shooting_from_collocation(this.__wbg_ptr, setup_val, intervals, integration_steps_per_segment);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Initializes a period-doubled limit cycle from a period-doubling bifurcation.
     * Takes the LC state at the PD point and constructs a doubled-period initial guess
     * by computing the PD eigenvector and perturbing the original orbit.
     * @param {Float64Array} lc_state
     * @param {string} param_name
     * @param {number} param_value
     * @param {number} ntst
     * @param {number} ncol
     * @param {number} amplitude
     * @returns {any}
     */
    init_lc_from_pd(lc_state, param_name, param_value, ntst, ncol, amplitude) {
        const ptr0 = passArrayF64ToWasm0(lc_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(param_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_init_lc_from_pd(this.__wbg_ptr, ptr0, len0, ptr1, len1, param_value, ntst, ncol, amplitude);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Continues an NS (Neimark-Sacker) bifurcation curve in two-parameter space.
     * @param {Float64Array} lc_state
     * @param {number} period
     * @param {string} param1_name
     * @param {number} param1_value
     * @param {string} param2_name
     * @param {number} param2_value
     * @param {number} initial_k
     * @param {number} ntst
     * @param {number} ncol
     * @param {any} settings_val
     * @param {boolean} forward
     * @returns {any}
     */
    continue_ns_curve(lc_state, period, param1_name, param1_value, param2_name, param2_value, initial_k, ntst, ncol, settings_val, forward) {
        const ptr0 = passArrayF64ToWasm0(lc_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(param1_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_continue_ns_curve(this.__wbg_ptr, ptr0, len0, period, ptr1, len1, param1_value, ptr2, len2, param2_value, initial_k, ntst, ncol, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Continues a PD (Period-Doubling) bifurcation curve in two-parameter space.
     * @param {Float64Array} lc_state
     * @param {number} period
     * @param {string} param1_name
     * @param {number} param1_value
     * @param {string} param2_name
     * @param {number} param2_value
     * @param {number} ntst
     * @param {number} ncol
     * @param {any} settings_val
     * @param {boolean} forward
     * @returns {any}
     */
    continue_pd_curve(lc_state, period, param1_name, param1_value, param2_name, param2_value, ntst, ncol, settings_val, forward) {
        const ptr0 = passArrayF64ToWasm0(lc_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(param1_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_continue_pd_curve(this.__wbg_ptr, ptr0, len0, period, ptr1, len1, param1_value, ptr2, len2, param2_value, ntst, ncol, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Initializes a limit cycle guess from a Hopf bifurcation point.
     * Returns the LimitCycleSetup as a serialized JsValue.
     * @param {Float64Array} hopf_state
     * @param {string} parameter_name
     * @param {number} param_value
     * @param {number} amplitude
     * @param {number} ntst
     * @param {number} ncol
     * @returns {any}
     */
    init_lc_from_hopf(hopf_state, parameter_name, param_value, amplitude, ntst, ncol) {
        const ptr0 = passArrayF64ToWasm0(hopf_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_init_lc_from_hopf(this.__wbg_ptr, ptr0, len0, ptr1, len1, param_value, amplitude, ntst, ncol);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Continues an LPC (Limit Point of Cycles) bifurcation curve in two-parameter space.
     *
     * # Arguments
     * * `lc_state` - Flattened LC collocation state at the LPC point
     * * `period` - Period at the LPC point
     * * `param1_name` - Name of first active parameter
     * * `param1_value` - Value of first parameter at LPC point
     * * `param2_name` - Name of second active parameter
     * * `param2_value` - Value of second parameter at LPC point
     * * `ntst` - Number of mesh intervals in collocation
     * * `ncol` - Collocation degree
     * * `settings_val` - Continuation settings as JsValue
     * * `forward` - Direction of continuation
     * @param {Float64Array} lc_state
     * @param {number} period
     * @param {string} param1_name
     * @param {number} param1_value
     * @param {string} param2_name
     * @param {number} param2_value
     * @param {number} ntst
     * @param {number} ncol
     * @param {any} settings_val
     * @param {boolean} forward
     * @returns {any}
     */
    continue_lpc_curve(lc_state, period, param1_name, param1_value, param2_name, param2_value, ntst, ncol, settings_val, forward) {
        const ptr0 = passArrayF64ToWasm0(lc_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(param1_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_continue_lpc_curve(this.__wbg_ptr, ptr0, len0, period, ptr1, len1, param1_value, ptr2, len2, param2_value, ntst, ncol, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Initializes a limit cycle guess from a computed orbit.
     * The orbit should have converged to a stable limit cycle.
     * Returns the LimitCycleSetup as a serialized JsValue.
     * @param {Float64Array} orbit_times
     * @param {Float64Array} orbit_states_flat
     * @param {number} param_value
     * @param {number} ntst
     * @param {number} ncol
     * @param {number} tolerance
     * @returns {any}
     */
    init_lc_from_orbit(orbit_times, orbit_states_flat, param_value, ntst, ncol, tolerance) {
        const ptr0 = passArrayF64ToWasm0(orbit_times, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(orbit_states_flat, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_init_lc_from_orbit(this.__wbg_ptr, ptr0, len0, ptr1, len1, param_value, ntst, ncol, tolerance);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Continues a fold (saddle-node) bifurcation curve in two-parameter space.
     *
     * # Arguments
     * * `fold_state` - State vector at the fold bifurcation point
     * * `param1_name` - Name of first active parameter
     * * `param1_value` - Value of first parameter at fold point
     * * `param2_name` - Name of second active parameter
     * * `param2_value` - Value of second parameter at fold point
     * * `settings_val` - Continuation settings (step size, max steps, etc.)
     * * `forward` - Direction of continuation
     *
     * # Returns
     * A `Codim1CurveBranch` containing the fold curve and detected codim-2 bifurcations
     * @param {Float64Array} fold_state
     * @param {string} param1_name
     * @param {number} param1_value
     * @param {string} param2_name
     * @param {number} param2_value
     * @param {number} map_iterations
     * @param {any} settings_val
     * @param {boolean} forward
     * @returns {any}
     */
    continue_fold_curve(fold_state, param1_name, param1_value, param2_name, param2_value, map_iterations, settings_val, forward) {
        const ptr0 = passArrayF64ToWasm0(fold_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(param1_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_continue_fold_curve(this.__wbg_ptr, ptr0, len0, ptr1, len1, param1_value, ptr2, len2, param2_value, map_iterations, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Continues a Hopf bifurcation curve in two-parameter space.
     *
     * # Arguments
     * * `hopf_state` - State vector at the Hopf bifurcation point
     * * `hopf_omega` - Hopf frequency (imaginary part of critical eigenvalue)
     * * `param1_name` - Name of first active parameter
     * * `param1_value` - Value of first parameter at Hopf point
     * * `param2_name` - Name of second active parameter
     * * `param2_value` - Value of second parameter at Hopf point
     * * `settings_val` - Continuation settings
     * * `forward` - Direction of continuation
     *
     * # Returns
     * A `Codim1CurveBranch` containing the Hopf curve and detected codim-2 bifurcations
     * @param {Float64Array} hopf_state
     * @param {number} hopf_omega
     * @param {string} param1_name
     * @param {number} param1_value
     * @param {string} param2_name
     * @param {number} param2_value
     * @param {number} map_iterations
     * @param {any} settings_val
     * @param {boolean} forward
     * @returns {any}
     */
    continue_hopf_curve(hopf_state, hopf_omega, param1_name, param1_value, param2_name, param2_value, map_iterations, settings_val, forward) {
        const ptr0 = passArrayF64ToWasm0(hopf_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(param1_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_continue_hopf_curve(this.__wbg_ptr, ptr0, len0, hopf_omega, ptr1, len1, param1_value, ptr2, len2, param2_value, map_iterations, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {any} branch_val
     * @param {string} parameter_name
     * @param {number} map_iterations
     * @param {any} settings_val
     * @param {boolean} forward
     * @returns {any}
     */
    extend_continuation(branch_val, parameter_name, map_iterations, settings_val, forward) {
        const ptr0 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_extend_continuation(this.__wbg_ptr, branch_val, ptr0, len0, map_iterations, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} equilibrium_state
     * @param {string} parameter_name
     * @param {number} map_iterations
     * @param {any} settings_val
     * @param {boolean} forward
     * @returns {any}
     */
    compute_continuation(equilibrium_state, parameter_name, map_iterations, settings_val, forward) {
        const ptr0 = passArrayF64ToWasm0(equilibrium_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_continuation(this.__wbg_ptr, ptr0, len0, ptr1, len1, map_iterations, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} equilibrium_state
     * @param {number} map_iterations
     * @param {any} settings_val
     * @returns {any}
     */
    compute_eq_manifold_1d(equilibrium_state, map_iterations, settings_val) {
        const ptr0 = passArrayF64ToWasm0(equilibrium_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_eq_manifold_1d(this.__wbg_ptr, ptr0, len0, map_iterations, settings_val);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} equilibrium_state
     * @param {any} settings_val
     * @returns {any}
     */
    compute_eq_manifold_2d(equilibrium_state, settings_val) {
        const ptr0 = passArrayF64ToWasm0(equilibrium_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_eq_manifold_2d(this.__wbg_ptr, ptr0, len0, settings_val);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Initializes a period-doubled map cycle seed from a period-doubling bifurcation.
     * Takes the cycle state at the PD point and returns a perturbed seed for the doubled cycle.
     * @param {Float64Array} pd_state
     * @param {string} param_name
     * @param {number} param_value
     * @param {number} map_iterations
     * @param {number} amplitude
     * @returns {any}
     */
    init_map_cycle_from_pd(pd_state, param_name, param_value, map_iterations, amplitude) {
        const ptr0 = passArrayF64ToWasm0(pd_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(param_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_init_map_cycle_from_pd(this.__wbg_ptr, ptr0, len0, ptr1, len1, param_value, map_iterations, amplitude);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} lc_state
     * @param {string} param_name
     * @param {number} param_value
     * @param {number} ncol
     * @param {Float64Array} normalized_mesh
     * @param {number} amplitude
     * @returns {any}
     */
    init_lc_from_pd_on_mesh(lc_state, param_name, param_value, ncol, normalized_mesh, amplitude) {
        const ptr0 = passArrayF64ToWasm0(lc_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(param_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(normalized_mesh, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_init_lc_from_pd_on_mesh(this.__wbg_ptr, ptr0, len0, ptr1, len1, param_value, ncol, ptr2, len2, amplitude);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} cycle_state
     * @param {number} ntst
     * @param {number} ncol
     * @param {any} floquet_multipliers_val
     * @param {any} settings_val
     * @returns {any}
     */
    compute_cycle_manifold_2d(cycle_state, ntst, ncol, floquet_multipliers_val, settings_val) {
        const ptr0 = passArrayF64ToWasm0(cycle_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_cycle_manifold_2d(this.__wbg_ptr, ptr0, len0, ntst, ncol, floquet_multipliers_val, settings_val);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Continues an LPC (Limit Point of Cycles) bifurcation curve in two-parameter space.
     *
     * # Arguments
     * * `lc_state` - Flattened LC collocation state at the LPC point
     * * `period` - Period at the LPC point
     * * `param1_name` - Name of first active parameter
     * * `param1_value` - Value of first parameter at LPC point
     * * `param2_name` - Name of second active parameter
     * * `param2_value` - Value of second parameter at LPC point
     * * `ntst` - Number of mesh intervals in collocation
     * * `ncol` - Collocation degree
     * * `settings_val` - Continuation settings as JsValue
     * * `forward` - Direction of continuation
     * @param {Float64Array} lc_state
     * @param {number} period
     * @param {string} param1_name
     * @param {number} param1_value
     * @param {string} param2_name
     * @param {number} param2_value
     * @param {number} ntst
     * @param {number} ncol
     * @param {any} settings_val
     * @param {boolean} forward
     * @returns {any}
     */
    continue_isoperiodic_curve(lc_state, period, param1_name, param1_value, param2_name, param2_value, ntst, ncol, settings_val, forward) {
        const ptr0 = passArrayF64ToWasm0(lc_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(param1_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_continue_isoperiodic_curve(this.__wbg_ptr, ptr0, len0, period, ptr1, len1, param1_value, ptr2, len2, param2_value, ntst, ncol, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Compute equilibrium continuation with progress reporting capability.
     * Returns a serialized StepResult after running the specified number of steps.
     *
     * This is a convenience method that runs the full continuation but returns
     * progress information. For true stepped execution, use WasmEquilibriumRunner.
     * @param {Float64Array} equilibrium_state
     * @param {string} parameter_name
     * @param {number} map_iterations
     * @param {any} settings_val
     * @param {boolean} forward
     * @param {number} _batch_size
     * @returns {any}
     */
    compute_continuation_stepped(equilibrium_state, parameter_name, map_iterations, settings_val, forward, _batch_size) {
        const ptr0 = passArrayF64ToWasm0(equilibrium_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_continuation_stepped(this.__wbg_ptr, ptr0, len0, ptr1, len1, map_iterations, settings_val, forward, _batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {any} seed_val
     * @param {string} parameter_name
     * @param {string} param2_name
     * @param {number} target_ntst
     * @param {number} target_ncol
     * @param {boolean} free_time
     * @param {boolean} free_eps0
     * @param {boolean} free_eps1
     * @returns {any}
     */
    init_heteroclinic_from_orbit(seed_val, parameter_name, param2_name, target_ntst, target_ncol, free_time, free_eps0, free_eps1) {
        const ptr0 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_init_heteroclinic_from_orbit(this.__wbg_ptr, seed_val, ptr0, len0, ptr1, len1, target_ntst, target_ncol, free_time, free_eps0, free_eps1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} gh_state
     * @param {Float64Array} neighbor_state
     * @param {string} param1_name
     * @param {string} param2_name
     * @param {number} gh_param1
     * @param {number} gh_param2
     * @param {number} neighbor_param1
     * @param {number} neighbor_param2
     * @param {number} gh_kappa
     * @param {number} neighbor_kappa
     * @param {number} neighbor_l1
     * @param {number} second_lyapunov
     * @param {number} amplitude
     * @param {number} ntst
     * @param {number} ncol
     * @param {number} tolerance
     * @returns {any}
     */
    init_lpc_from_generalized_hopf(gh_state, neighbor_state, param1_name, param2_name, gh_param1, gh_param2, neighbor_param1, neighbor_param2, gh_kappa, neighbor_kappa, neighbor_l1, second_lyapunov, amplitude, ntst, ncol, tolerance) {
        const ptr0 = passArrayF64ToWasm0(gh_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(neighbor_state, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(param1_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_init_lpc_from_generalized_hopf(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, gh_param1, gh_param2, neighbor_param1, neighbor_param2, gh_kappa, neighbor_kappa, neighbor_l1, second_lyapunov, amplitude, ntst, ncol, tolerance);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} state
     * @param {string} parameter_name
     * @param {number} map_iterations
     * @param {number} param_value
     * @returns {any}
     */
    compute_equilibrium_eigenvalues(state, parameter_name, map_iterations, param_value) {
        const ptr0 = passArrayF64ToWasm0(state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_equilibrium_eigenvalues(this.__wbg_ptr, ptr0, len0, ptr1, len1, map_iterations, param_value);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {any} setup_val
     * @param {any} settings_val
     * @param {boolean} forward
     * @returns {any}
     */
    compute_homoclinic_continuation(setup_val, settings_val, forward) {
        const ret = wasm.wasmsystem_compute_homoclinic_continuation(this.__wbg_ptr, setup_val, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} point_state
     * @param {number} source_ntst
     * @param {number} source_ncol
     * @param {boolean} source_free_time
     * @param {boolean} source_free_eps0
     * @param {boolean} source_free_eps1
     * @param {number} source_fixed_time
     * @param {number} source_fixed_eps0
     * @param {number} source_fixed_eps1
     * @param {string} parameter_name
     * @param {string} param2_name
     * @param {number} target_ntst
     * @param {number} target_ncol
     * @param {boolean} free_time
     * @param {boolean} free_eps0
     * @param {boolean} free_eps1
     * @returns {any}
     */
    init_homoclinic_from_homoclinic(point_state, source_ntst, source_ncol, source_free_time, source_free_eps0, source_free_eps1, source_fixed_time, source_fixed_eps0, source_fixed_eps1, parameter_name, param2_name, target_ntst, target_ncol, free_time, free_eps0, free_eps1) {
        const ptr0 = passArrayF64ToWasm0(point_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_init_homoclinic_from_homoclinic(this.__wbg_ptr, ptr0, len0, source_ntst, source_ncol, source_free_time, source_free_eps0, source_free_eps1, source_fixed_time, source_fixed_eps0, source_fixed_eps1, ptr1, len1, ptr2, len2, target_ntst, target_ncol, free_time, free_eps0, free_eps1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Computes limit cycle continuation from an initial setup (from init_lc_from_hopf).
     * @param {any} setup_val
     * @param {string} parameter_name
     * @param {any} settings_val
     * @param {boolean} forward
     * @returns {any}
     */
    compute_limit_cycle_continuation(setup_val, parameter_name, settings_val, forward) {
        const ptr0 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_limit_cycle_continuation(this.__wbg_ptr, setup_val, ptr0, len0, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {any} branch_val
     * @param {any} settings_val
     * @param {boolean} extend_forward
     * @returns {any}
     */
    extend_heteroclinic_continuation(branch_val, settings_val, extend_forward) {
        const ret = wasm.wasmsystem_extend_heteroclinic_continuation(this.__wbg_ptr, branch_val, settings_val, extend_forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Extend a persisted 2D manifold while reporting each accepted new ring.
     * @param {any} branch_val
     * @param {any} settings_val
     * @param {Function} progress_callback
     * @returns {any}
     */
    extend_manifold_2d_with_progress(branch_val, settings_val, progress_callback) {
        const ret = wasm.wasmsystem_extend_manifold_2d_with_progress(this.__wbg_ptr, branch_val, settings_val, progress_callback);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} state
     * @param {string} param1_name
     * @param {string} param2_name
     * @param {number} param1_value
     * @param {number} param2_value
     * @param {number} perturbation
     * @param {number} tolerance
     * @returns {any}
     */
    init_curves_from_bogdanov_takens(state, param1_name, param2_name, param1_value, param2_value, perturbation, tolerance) {
        const ptr0 = passArrayF64ToWasm0(state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(param1_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_init_curves_from_bogdanov_takens(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, param1_value, param2_value, perturbation, tolerance);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} lc_state
     * @param {number} source_ntst
     * @param {number} source_ncol
     * @param {string} parameter_name
     * @param {string} param2_name
     * @param {number} target_ntst
     * @param {number} target_ncol
     * @param {boolean} free_time
     * @param {boolean} free_eps0
     * @param {boolean} free_eps1
     * @returns {any}
     */
    init_homoclinic_from_large_cycle(lc_state, source_ntst, source_ncol, parameter_name, param2_name, target_ntst, target_ncol, free_time, free_eps0, free_eps1) {
        const ptr0 = passArrayF64ToWasm0(lc_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_init_homoclinic_from_large_cycle(this.__wbg_ptr, ptr0, len0, source_ntst, source_ncol, ptr1, len1, ptr2, len2, target_ntst, target_ncol, free_time, free_eps0, free_eps1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {any} setup_val
     * @param {any} settings_val
     * @param {boolean} forward
     * @returns {any}
     */
    compute_heteroclinic_continuation(setup_val, settings_val, forward) {
        const ret = wasm.wasmsystem_compute_heteroclinic_continuation(this.__wbg_ptr, setup_val, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} cycle_state
     * @param {number} ntst
     * @param {number} ncol
     * @param {string} parameter_name
     * @returns {any}
     */
    compute_limit_cycle_floquet_modes(cycle_state, ntst, ncol, parameter_name) {
        const ptr0 = passArrayF64ToWasm0(cycle_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_limit_cycle_floquet_modes(this.__wbg_ptr, ptr0, len0, ntst, ncol, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} equilibrium_state
     * @param {any} settings_val
     * @param {Function} progress_callback
     * @returns {any}
     */
    compute_eq_manifold_2d_with_progress(equilibrium_state, settings_val, progress_callback) {
        const ptr0 = passArrayF64ToWasm0(equilibrium_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_eq_manifold_2d_with_progress(this.__wbg_ptr, ptr0, len0, settings_val, progress_callback);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {any} setup_val
     * @param {any} settings_val
     * @param {boolean} forward
     * @returns {any}
     */
    compute_homotopy_saddle_continuation(setup_val, settings_val, forward) {
        const ret = wasm.wasmsystem_compute_homotopy_saddle_continuation(this.__wbg_ptr, setup_val, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} state
     * @param {string} param1_name
     * @param {string} param2_name
     * @param {number} param1_value
     * @param {number} param2_value
     * @param {number} perturbation
     * @param {number} ntst
     * @param {number} ncol
     * @param {number} tolerance
     * @returns {any}
     */
    init_homoclinic_from_bogdanov_takens(state, param1_name, param2_name, param1_value, param2_value, perturbation, ntst, ncol, tolerance) {
        const ptr0 = passArrayF64ToWasm0(state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(param1_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_init_homoclinic_from_bogdanov_takens(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, param1_value, param2_value, perturbation, ntst, ncol, tolerance);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} stage_d_state
     * @param {number} source_ntst
     * @param {number} source_ncol
     * @param {string} parameter_name
     * @param {string} param2_name
     * @param {number} target_ntst
     * @param {number} target_ncol
     * @param {boolean} free_time
     * @param {boolean} free_eps0
     * @param {boolean} free_eps1
     * @returns {any}
     */
    init_homoclinic_from_homotopy_saddle(stage_d_state, source_ntst, source_ncol, parameter_name, param2_name, target_ntst, target_ncol, free_time, free_eps0, free_eps1) {
        const ptr0 = passArrayF64ToWasm0(stage_d_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_init_homoclinic_from_homotopy_saddle(this.__wbg_ptr, ptr0, len0, source_ntst, source_ncol, ptr1, len1, ptr2, len2, target_ntst, target_ncol, free_time, free_eps0, free_eps1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} equilibrium_state
     * @param {string} parameter_name
     * @param {string} param2_name
     * @param {number} ntst
     * @param {number} ncol
     * @param {number} eps0
     * @param {number} eps1
     * @param {number} time
     * @param {number} eps1_tol
     * @returns {any}
     */
    init_homotopy_saddle_from_equilibrium(equilibrium_state, parameter_name, param2_name, ntst, ncol, eps0, eps1, time, eps1_tol) {
        const ptr0 = passArrayF64ToWasm0(equilibrium_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_init_homotopy_saddle_from_equilibrium(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ntst, ncol, eps0, eps1, time, eps1_tol);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} cycle_state
     * @param {number} ntst
     * @param {number} ncol
     * @param {any} floquet_multipliers_val
     * @param {any} settings_val
     * @param {Function} progress_callback
     * @returns {any}
     */
    compute_cycle_manifold_2d_with_progress(cycle_state, ntst, ncol, floquet_multipliers_val, settings_val, progress_callback) {
        const ptr0 = passArrayF64ToWasm0(cycle_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_cycle_manifold_2d_with_progress(this.__wbg_ptr, ptr0, len0, ntst, ncol, floquet_multipliers_val, settings_val, progress_callback);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Mesh-aware Method 2 initializer for restarting an adaptive homoclinic
     * collocation point without first pretending its source mesh is uniform.
     * @param {Float64Array} point_state
     * @param {number} source_ncol
     * @param {Float64Array} source_normalized_mesh
     * @param {boolean} source_free_time
     * @param {boolean} source_free_eps0
     * @param {boolean} source_free_eps1
     * @param {number} source_fixed_time
     * @param {number} source_fixed_eps0
     * @param {number} source_fixed_eps1
     * @param {string} parameter_name
     * @param {string} param2_name
     * @param {number} target_ncol
     * @param {Float64Array} target_normalized_mesh
     * @param {boolean} free_time
     * @param {boolean} free_eps0
     * @param {boolean} free_eps1
     * @returns {any}
     */
    init_homoclinic_from_homoclinic_on_mesh(point_state, source_ncol, source_normalized_mesh, source_free_time, source_free_eps0, source_free_eps1, source_fixed_time, source_fixed_eps0, source_fixed_eps1, parameter_name, param2_name, target_ncol, target_normalized_mesh, free_time, free_eps0, free_eps1) {
        const ptr0 = passArrayF64ToWasm0(point_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(source_normalized_mesh, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArrayF64ToWasm0(target_normalized_mesh, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_init_homoclinic_from_homoclinic_on_mesh(this.__wbg_ptr, ptr0, len0, source_ncol, ptr1, len1, source_free_time, source_free_eps0, source_free_eps1, source_fixed_time, source_fixed_eps0, source_fixed_eps1, ptr2, len2, ptr3, len3, target_ncol, ptr4, len4, free_time, free_eps0, free_eps1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Nonuniform-mesh counterpart of `init_homoclinic_from_large_cycle`.
     * `source_normalized_mesh` contains the source LC interval boundaries;
     * source NTST is inferred from its length.
     * @param {Float64Array} lc_state
     * @param {number} source_ncol
     * @param {Float64Array} source_normalized_mesh
     * @param {string} parameter_name
     * @param {string} param2_name
     * @param {number} target_ntst
     * @param {number} target_ncol
     * @param {boolean} free_time
     * @param {boolean} free_eps0
     * @param {boolean} free_eps1
     * @returns {any}
     */
    init_homoclinic_from_large_cycle_on_mesh(lc_state, source_ncol, source_normalized_mesh, parameter_name, param2_name, target_ntst, target_ncol, free_time, free_eps0, free_eps1) {
        const ptr0 = passArrayF64ToWasm0(lc_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(source_normalized_mesh, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_init_homoclinic_from_large_cycle_on_mesh(this.__wbg_ptr, ptr0, len0, source_ncol, ptr1, len1, ptr2, len2, ptr3, len3, target_ntst, target_ncol, free_time, free_eps0, free_eps1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} cycle_state
     * @param {number} ncol
     * @param {Float64Array} normalized_mesh
     * @param {string} parameter_name
     * @returns {any}
     */
    compute_limit_cycle_floquet_modes_on_mesh(cycle_state, ncol, normalized_mesh, parameter_name) {
        const ptr0 = passArrayF64ToWasm0(cycle_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(normalized_mesh, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_limit_cycle_floquet_modes_on_mesh(this.__wbg_ptr, ptr0, len0, ncol, ptr1, len1, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} cycle_state
     * @param {number} ntst
     * @param {number} ncol
     * @param {string} parameter_name
     * @param {string} backend
     * @returns {any}
     */
    compute_limit_cycle_floquet_modes_with_backend(cycle_state, ntst, ncol, parameter_name, backend) {
        const ptr0 = passArrayF64ToWasm0(cycle_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(backend, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_limit_cycle_floquet_modes_with_backend(this.__wbg_ptr, ptr0, len0, ntst, ncol, ptr1, len1, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} cycle_state
     * @param {number} ncol
     * @param {Float64Array} normalized_mesh
     * @param {string} parameter_name
     * @param {string} backend
     * @returns {any}
     */
    compute_limit_cycle_floquet_modes_on_mesh_with_backend(cycle_state, ncol, normalized_mesh, parameter_name, backend) {
        const ptr0 = passArrayF64ToWasm0(cycle_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(normalized_mesh, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(backend, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_limit_cycle_floquet_modes_on_mesh_with_backend(this.__wbg_ptr, ptr0, len0, ncol, ptr1, len1, ptr2, len2, ptr3, len3);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} start_state
     * @param {number} start_time
     * @param {number} steps
     * @param {number} dt
     * @param {number} qr_stride
     * @returns {Float64Array}
     */
    compute_lyapunov_exponents(start_state, start_time, steps, dt, qr_stride) {
        const ptr0 = passArrayF64ToWasm0(start_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_lyapunov_exponents(this.__wbg_ptr, ptr0, len0, start_time, steps, dt, qr_stride);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} start_state
     * @param {number} start_time
     * @param {number} window_steps
     * @param {number} dt
     * @param {number} qr_stride
     * @param {number} forward_transient
     * @param {number} backward_transient
     * @returns {any}
     */
    compute_covariant_lyapunov_vectors(start_state, start_time, window_steps, dt, qr_stride, forward_transient, backward_transient) {
        const ptr0 = passArrayF64ToWasm0(start_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_covariant_lyapunov_vectors(this.__wbg_ptr, ptr0, len0, start_time, window_steps, dt, qr_stride, forward_transient, backward_transient);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string} period_expression
     * @param {number} iteration_period
     * @param {number} phase
     * @param {number} response_multiple
     * @param {number} steps_per_forcing_period
     * @param {Float64Array} initial_guess
     * @param {number} max_steps
     * @param {number} damping
     * @param {number} tolerance
     * @returns {any}
     */
    solve_forced_response(period_expression, iteration_period, phase, response_multiple, steps_per_forcing_period, initial_guess, max_steps, damping, tolerance) {
        const ptr0 = passStringToWasm0(period_expression, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(initial_guess, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_solve_forced_response(this.__wbg_ptr, ptr0, len0, iteration_period, phase, response_multiple, steps_per_forcing_period, ptr1, len1, max_steps, damping, tolerance);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string} period_expression
     * @param {number} iteration_period
     * @returns {number}
     */
    validate_periodic_forcing(period_expression, iteration_period) {
        const ptr0 = passStringToWasm0(period_expression, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_validate_periodic_forcing(this.__wbg_ptr, ptr0, len0, iteration_period);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0];
    }
    /**
     * @param {string} period_expression
     * @param {number} iteration_period
     * @param {number} phase
     * @param {number} steps_per_forcing_period
     * @param {number} initial_context
     * @param {Float64Array} initial_state
     * @returns {any}
     */
    advance_forced_response_seed(period_expression, iteration_period, phase, steps_per_forcing_period, initial_context, initial_state) {
        const ptr0 = passStringToWasm0(period_expression, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(initial_state, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_advance_forced_response_seed(this.__wbg_ptr, ptr0, len0, iteration_period, phase, steps_per_forcing_period, initial_context, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} initial_guess
     * @param {number} max_steps
     * @param {number} damping
     * @param {number} map_iterations
     * @returns {any}
     */
    solve_equilibrium(initial_guess, max_steps, damping, map_iterations) {
        const ptr0 = passArrayF64ToWasm0(initial_guess, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_solve_equilibrium(this.__wbg_ptr, ptr0, len0, max_steps, damping, map_iterations);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} initial_guess
     * @param {number} max_steps
     * @param {number} damping
     * @param {number} map_iterations
     * @param {Float64Array} flattened_roots
     * @param {number} exponent
     * @param {number} shift
     * @returns {any}
     */
    solve_equilibrium_deflated(initial_guess, max_steps, damping, map_iterations, flattened_roots, exponent, shift) {
        const ptr0 = passArrayF64ToWasm0(initial_guess, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(flattened_roots, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_solve_equilibrium_deflated(this.__wbg_ptr, ptr0, len0, max_steps, damping, map_iterations, ptr1, len1, exponent, shift);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} initial_guess
     * @param {number} max_steps
     * @param {number} damping
     * @param {number} map_iterations
     * @param {Float64Array} flattened_roots
     * @param {Float64Array} exponents
     * @param {Float64Array} shifts
     * @returns {any}
     */
    solve_equilibrium_deflated_targets(initial_guess, max_steps, damping, map_iterations, flattened_roots, exponents, shifts) {
        const ptr0 = passArrayF64ToWasm0(initial_guess, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(flattened_roots, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(exponents, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayF64ToWasm0(shifts, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_solve_equilibrium_deflated_targets(this.__wbg_ptr, ptr0, len0, max_steps, damping, map_iterations, ptr1, len1, ptr2, len2, ptr3, len3);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {any} request_val
     * @returns {any}
     */
    compute_event_series_from_orbit(request_val) {
        const ret = wasm.wasmsystem_compute_event_series_from_orbit(this.__wbg_ptr, request_val);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {any} request_val
     * @returns {any}
     */
    compute_event_series_from_samples(request_val) {
        const ret = wasm.wasmsystem_compute_event_series_from_samples(this.__wbg_ptr, request_val);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmSystem.prototype[Symbol.dispose] = WasmSystem.prototype.free;

const WasmTransferOperatorRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmtransferoperatorrunner_free(ptr >>> 0, 1));

export class WasmTransferOperatorRunner {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmTransferOperatorRunnerFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmtransferoperatorrunner_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get_result() {
        const ret = wasm.wasmtransferoperatorrunner_get_result(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    get_progress() {
        const ret = wasm.wasmtransferoperatorrunner_get_progress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {Float64Array} minimums
     * @param {Float64Array} maximums
     * @param {Uint32Array} resolution
     * @param {number} samples_per_cell
     * @param {number} iterations
     * @param {number} max_stationary_iterations
     * @param {number} tolerance
     */
    constructor(equations, params, param_names, var_names, minimums, maximums, resolution, samples_per_cell, iterations, max_stationary_iterations, tolerance) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArrayF64ToWasm0(minimums, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF64ToWasm0(maximums, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passArray32ToWasm0(resolution, wasm.__wbindgen_malloc);
        const len6 = WASM_VECTOR_LEN;
        const ret = wasm.wasmtransferoperatorrunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, samples_per_cell, iterations, max_stationary_iterations, tolerance);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        WasmTransferOperatorRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} _batch_size
     * @returns {any}
     */
    run_steps(_batch_size) {
        const ret = wasm.wasmtransferoperatorrunner_run_steps(this.__wbg_ptr, _batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmTransferOperatorRunner.prototype[Symbol.dispose] = WasmTransferOperatorRunner.prototype.free;

const wbg_rayon_PoolBuilderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wbg_rayon_poolbuilder_free(ptr >>> 0, 1));

export class wbg_rayon_PoolBuilder {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(wbg_rayon_PoolBuilder.prototype);
        obj.__wbg_ptr = ptr;
        wbg_rayon_PoolBuilderFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        wbg_rayon_PoolBuilderFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wbg_rayon_poolbuilder_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    numThreads() {
        const ret = wasm.wbg_rayon_poolbuilder_numThreads(this.__wbg_ptr);
        return ret >>> 0;
    }
    build() {
        wasm.wbg_rayon_poolbuilder_build(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    receiver() {
        const ret = wasm.wbg_rayon_poolbuilder_receiver(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) wbg_rayon_PoolBuilder.prototype[Symbol.dispose] = wbg_rayon_PoolBuilder.prototype.free;

const EXPECTED_RESPONSE_TYPES = new Set(['basic', 'cors', 'default']);

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);

            } catch (e) {
                const validResponse = module.ok && EXPECTED_RESPONSE_TYPES.has(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);

    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };

        } else {
            return instance;
        }
    }
}

function __wbg_get_imports(memory) {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg_Error_e83987f665cf5504 = function(arg0, arg1) {
        const ret = Error(getStringFromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg_String_eecc4a11987127d6 = function(arg0, arg1) {
        const ret = String(arg1);
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbg___wbindgen_bigint_get_as_i64_f3ebc5a755000afd = function(arg0, arg1) {
        const v = arg1;
        const ret = typeof(v) === 'bigint' ? v : undefined;
        getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
    };
    imports.wbg.__wbg___wbindgen_boolean_get_6d5a1ee65bab5f68 = function(arg0) {
        const v = arg0;
        const ret = typeof(v) === 'boolean' ? v : undefined;
        return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
    };
    imports.wbg.__wbg___wbindgen_debug_string_df47ffb5e35e6763 = function(arg0, arg1) {
        const ret = debugString(arg1);
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbg___wbindgen_in_bb933bd9e1b3bc0f = function(arg0, arg1) {
        const ret = arg0 in arg1;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_bigint_cb320707dcd35f0b = function(arg0) {
        const ret = typeof(arg0) === 'bigint';
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_function_ee8a6c5833c90377 = function(arg0) {
        const ret = typeof(arg0) === 'function';
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_object_c818261d21f283a4 = function(arg0) {
        const val = arg0;
        const ret = typeof(val) === 'object' && val !== null;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_string_fbb76cb2940daafd = function(arg0) {
        const ret = typeof(arg0) === 'string';
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_undefined_2d472862bd29a478 = function(arg0) {
        const ret = arg0 === undefined;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_jsval_eq_6b13ab83478b1c50 = function(arg0, arg1) {
        const ret = arg0 === arg1;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_jsval_loose_eq_b664b38a2f582147 = function(arg0, arg1) {
        const ret = arg0 == arg1;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_memory_27faa6e0e73716bd = function() {
        const ret = wasm.memory;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_module_66f1f22805762dd9 = function() {
        const ret = __wbg_init.__wbindgen_wasm_module;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_number_get_a20bf9b85341449d = function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof(obj) === 'number' ? obj : undefined;
        getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
    };
    imports.wbg.__wbg___wbindgen_string_get_e4f06c90489ad01b = function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof(obj) === 'string' ? obj : undefined;
        var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbg___wbindgen_throw_b855445ff6a94295 = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };
    imports.wbg.__wbg_call_525440f72fbfc0ea = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = arg0.call(arg1, arg2);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_call_e762c39fa8ea36bf = function() { return handleError(function (arg0, arg1) {
        const ret = arg0.call(arg1);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_done_2042aa2670fb1db1 = function(arg0) {
        const ret = arg0.done;
        return ret;
    };
    imports.wbg.__wbg_entries_e171b586f8f6bdbf = function(arg0) {
        const ret = Object.entries(arg0);
        return ret;
    };
    imports.wbg.__wbg_error_7534b8e9a36f1ab4 = function(arg0, arg1) {
        let deferred0_0;
        let deferred0_1;
        try {
            deferred0_0 = arg0;
            deferred0_1 = arg1;
            console.error(getStringFromWasm0(arg0, arg1));
        } finally {
            wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
        }
    };
    imports.wbg.__wbg_from_a4ad7cbddd0d7135 = function(arg0) {
        const ret = Array.from(arg0);
        return ret;
    };
    imports.wbg.__wbg_get_7bed016f185add81 = function(arg0, arg1) {
        const ret = arg0[arg1 >>> 0];
        return ret;
    };
    imports.wbg.__wbg_get_efcb449f58ec27c2 = function() { return handleError(function (arg0, arg1) {
        const ret = Reflect.get(arg0, arg1);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_get_with_ref_key_6550b2c093d2eb18 = function(arg0, arg1) {
        const ret = arg0[arg1];
        return ret;
    };
    imports.wbg.__wbg_instanceof_ArrayBuffer_70beb1189ca63b38 = function(arg0) {
        let result;
        try {
            result = arg0 instanceof ArrayBuffer;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_instanceof_Uint8Array_20c8e73002f7af98 = function(arg0) {
        let result;
        try {
            result = arg0 instanceof Uint8Array;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_instanceof_Window_4846dbb3de56c84c = function(arg0) {
        let result;
        try {
            result = arg0 instanceof Window;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_isArray_96e0af9891d0945d = function(arg0) {
        const ret = Array.isArray(arg0);
        return ret;
    };
    imports.wbg.__wbg_isSafeInteger_d216eda7911dde36 = function(arg0) {
        const ret = Number.isSafeInteger(arg0);
        return ret;
    };
    imports.wbg.__wbg_iterator_e5822695327a3c39 = function() {
        const ret = Symbol.iterator;
        return ret;
    };
    imports.wbg.__wbg_length_69bca3cb64fc8748 = function(arg0) {
        const ret = arg0.length;
        return ret;
    };
    imports.wbg.__wbg_length_cdd215e10d9dd507 = function(arg0) {
        const ret = arg0.length;
        return ret;
    };
    imports.wbg.__wbg_new_1acc0b6eea89d040 = function() {
        const ret = new Object();
        return ret;
    };
    imports.wbg.__wbg_new_5a79be3ab53b8aa5 = function(arg0) {
        const ret = new Uint8Array(arg0);
        return ret;
    };
    imports.wbg.__wbg_new_68651c719dcda04e = function() {
        const ret = new Map();
        return ret;
    };
    imports.wbg.__wbg_new_8a6f238a6ece86ea = function() {
        const ret = new Error();
        return ret;
    };
    imports.wbg.__wbg_new_e17d9f43105b08be = function() {
        const ret = new Array();
        return ret;
    };
    imports.wbg.__wbg_new_from_slice_fde3e31e670b38a6 = function(arg0, arg1) {
        const ret = new Float64Array(getArrayF64FromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg_new_no_args_ee98eee5275000a4 = function(arg0, arg1) {
        const ret = new Function(getStringFromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg_next_020810e0ae8ebcb0 = function() { return handleError(function (arg0) {
        const ret = arg0.next();
        return ret;
    }, arguments) };
    imports.wbg.__wbg_next_2c826fe5dfec6b6a = function(arg0) {
        const ret = arg0.next;
        return ret;
    };
    imports.wbg.__wbg_prototypesetcall_2a6620b6922694b2 = function(arg0, arg1, arg2) {
        Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
    };
    imports.wbg.__wbg_set_3807d5f0bfc24aa7 = function(arg0, arg1, arg2) {
        arg0[arg1] = arg2;
    };
    imports.wbg.__wbg_set_907fb406c34a251d = function(arg0, arg1, arg2) {
        const ret = arg0.set(arg1, arg2);
        return ret;
    };
    imports.wbg.__wbg_set_c213c871859d6500 = function(arg0, arg1, arg2) {
        arg0[arg1 >>> 0] = arg2;
    };
    imports.wbg.__wbg_set_c2abbebe8b9ebee1 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = Reflect.set(arg0, arg1, arg2);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_stack_0ed75d68575b0f3c = function(arg0, arg1) {
        const ret = arg1.stack;
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbg_startWorkers_2ca11761e08ff5d5 = function(arg0, arg1, arg2) {
        const ret = startWorkers(arg0, arg1, wbg_rayon_PoolBuilder.__wrap(arg2));
        return ret;
    };
    imports.wbg.__wbg_static_accessor_GLOBAL_89e1d9ac6a1b250e = function() {
        const ret = typeof global === 'undefined' ? null : global;
        return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    };
    imports.wbg.__wbg_static_accessor_GLOBAL_THIS_8b530f326a9e48ac = function() {
        const ret = typeof globalThis === 'undefined' ? null : globalThis;
        return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    };
    imports.wbg.__wbg_static_accessor_SELF_6fdf4b64710cc91b = function() {
        const ret = typeof self === 'undefined' ? null : self;
        return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    };
    imports.wbg.__wbg_static_accessor_WINDOW_b45bfc5a37f6cfa2 = function() {
        const ret = typeof window === 'undefined' ? null : window;
        return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    };
    imports.wbg.__wbg_value_692627309814bb8c = function(arg0) {
        const ret = arg0.value;
        return ret;
    };
    imports.wbg.__wbindgen_cast_2241b6af4c4b2941 = function(arg0, arg1) {
        // Cast intrinsic for `Ref(String) -> Externref`.
        const ret = getStringFromWasm0(arg0, arg1);
        return ret;
    };
    imports.wbg.__wbindgen_cast_4625c577ab2ec9ee = function(arg0) {
        // Cast intrinsic for `U64 -> Externref`.
        const ret = BigInt.asUintN(64, arg0);
        return ret;
    };
    imports.wbg.__wbindgen_cast_9ae0607507abb057 = function(arg0) {
        // Cast intrinsic for `I64 -> Externref`.
        const ret = arg0;
        return ret;
    };
    imports.wbg.__wbindgen_cast_d6cd19b81560fd6e = function(arg0) {
        // Cast intrinsic for `F64 -> Externref`.
        const ret = arg0;
        return ret;
    };
    imports.wbg.__wbindgen_init_externref_table = function() {
        const table = wasm.__wbindgen_externrefs;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
        ;
    };
    imports.wbg.memory = memory || new WebAssembly.Memory({initial:21,maximum:16384,shared:true});

    return imports;
}

function __wbg_finalize_init(instance, module, thread_stack_size) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedDataViewMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;

    if (typeof thread_stack_size !== 'undefined' && (typeof thread_stack_size !== 'number' || thread_stack_size === 0 || thread_stack_size % 65536 !== 0)) { throw 'invalid stack size' }
    wasm.__wbindgen_start(thread_stack_size);
    return wasm;
}

function initSync(module, memory) {
    if (wasm !== undefined) return wasm;

    let thread_stack_size
    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module, memory, thread_stack_size} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports(memory);

    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }

    const instance = new WebAssembly.Instance(module, imports);

    return __wbg_finalize_init(instance, module, thread_stack_size);
}

async function __wbg_init(module_or_path, memory) {
    if (wasm !== undefined) return wasm;

    let thread_stack_size
    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path, memory, thread_stack_size} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('fork_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports(memory);

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module, thread_stack_size);
}

export { initSync };
export default __wbg_init;
