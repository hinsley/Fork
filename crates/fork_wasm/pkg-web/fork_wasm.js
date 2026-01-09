let wasm;

let cachedUint8ArrayMemory0 = null;

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

cachedTextDecoder.decode();

const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let WASM_VECTOR_LEN = 0;

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
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
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
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
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
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
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} system_type
     * @param {any} branch_val
     * @param {string} parameter_name
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, system_type, branch_val, parameter_name, settings_val, forward) {
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
        const ret = wasm.wasmcontinuationextensionrunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, branch_val, ptr5, len5, settings_val, forward);
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
     * @param {Float64Array} equilibrium_state
     * @param {string} parameter_name
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, system_type, equilibrium_state, parameter_name, settings_val, forward) {
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
        const ret = wasm.wasmequilibriumrunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, settings_val, forward);
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
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} system_type
     * @param {Float64Array} initial_guess
     * @param {number} max_steps
     * @param {number} damping
     */
    constructor(equations, params, param_names, var_names, system_type, initial_guess, max_steps, damping) {
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
        const ret = wasm.wasmequilibriumsolverrunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, max_steps, damping);
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
     * @param {Float64Array} fold_state
     * @param {string} param1_name
     * @param {number} param1_value
     * @param {string} param2_name
     * @param {number} param2_value
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, system_type, fold_state, param1_name, param1_value, param2_name, param2_value, settings_val, forward) {
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
        const ret = wasm.wasmfoldcurverunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, param1_value, ptr7, len7, param2_value, settings_val, forward);
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
     * @param {Float64Array} hopf_state
     * @param {number} hopf_omega
     * @param {string} param1_name
     * @param {number} param1_value
     * @param {string} param2_name
     * @param {number} param2_value
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, system_type, hopf_state, hopf_omega, param1_name, param1_value, param2_name, param2_value, settings_val, forward) {
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
        const ret = wasm.wasmhopfcurverunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, hopf_omega, ptr6, len6, param1_value, ptr7, len7, param2_value, settings_val, forward);
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
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, lc_state, period, param1_name, param1_value, param2_name, param2_value, ntst, ncol, settings_val, forward) {
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
        const ret = wasm.wasmlpccurverunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, period, ptr5, len5, param1_value, ptr6, len6, param2_value, ntst, ncol, settings_val, forward);
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
     * @param {string[]} equations
     * @param {Float64Array} params
     * @param {string[]} param_names
     * @param {string[]} var_names
     * @param {string} _system_type
     * @param {any} setup_val
     * @param {string} parameter_name
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, _system_type, setup_val, parameter_name, settings_val, forward) {
        const ptr0 = passArrayJsValueToWasm0(equations, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(param_names, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(var_names, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(_system_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
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
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, lc_state, period, param1_name, param1_value, param2_name, param2_value, initial_k, ntst, ncol, settings_val, forward) {
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
        const ret = wasm.wasmnscurverunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, period, ptr5, len5, param1_value, ptr6, len6, param2_value, initial_k, ntst, ncol, settings_val, forward);
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
     * @param {any} settings_val
     * @param {boolean} forward
     */
    constructor(equations, params, param_names, var_names, lc_state, period, param1_name, param1_value, param2_name, param2_value, ntst, ncol, settings_val, forward) {
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
        const ret = wasm.wasmpdcurverunner_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, period, ptr5, len5, param1_value, ptr6, len6, param2_value, ntst, ncol, settings_val, forward);
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
     * @param {Float64Array} initial_guess
     * @param {number} max_steps
     * @param {number} damping
     * @returns {any}
     */
    solve_equilibrium(initial_guess, max_steps, damping) {
        const ptr0 = passArrayF64ToWasm0(initial_guess, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_solve_equilibrium(this.__wbg_ptr, ptr0, len0, max_steps, damping);
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
     * @param {any} settings_val
     * @param {boolean} forward
     * @returns {any}
     */
    continue_fold_curve(fold_state, param1_name, param1_value, param2_name, param2_value, settings_val, forward) {
        const ptr0 = passArrayF64ToWasm0(fold_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(param1_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_continue_fold_curve(this.__wbg_ptr, ptr0, len0, ptr1, len1, param1_value, ptr2, len2, param2_value, settings_val, forward);
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
     * @param {any} settings_val
     * @param {boolean} forward
     * @returns {any}
     */
    continue_hopf_curve(hopf_state, hopf_omega, param1_name, param1_value, param2_name, param2_value, settings_val, forward) {
        const ptr0 = passArrayF64ToWasm0(hopf_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(param1_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(param2_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_continue_hopf_curve(this.__wbg_ptr, ptr0, len0, hopf_omega, ptr1, len1, param1_value, ptr2, len2, param2_value, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {any} branch_val
     * @param {string} parameter_name
     * @param {any} settings_val
     * @param {boolean} forward
     * @returns {any}
     */
    extend_continuation(branch_val, parameter_name, settings_val, forward) {
        const ptr0 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_extend_continuation(this.__wbg_ptr, branch_val, ptr0, len0, settings_val, forward);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} equilibrium_state
     * @param {string} parameter_name
     * @param {any} settings_val
     * @param {boolean} forward
     * @returns {any}
     */
    compute_continuation(equilibrium_state, parameter_name, settings_val, forward) {
        const ptr0 = passArrayF64ToWasm0(equilibrium_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_continuation(this.__wbg_ptr, ptr0, len0, ptr1, len1, settings_val, forward);
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
     * @param {any} settings_val
     * @param {boolean} forward
     * @param {number} _batch_size
     * @returns {any}
     */
    compute_continuation_stepped(equilibrium_state, parameter_name, settings_val, forward, _batch_size) {
        const ptr0 = passArrayF64ToWasm0(equilibrium_state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_continuation_stepped(this.__wbg_ptr, ptr0, len0, ptr1, len1, settings_val, forward, _batch_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Float64Array} state
     * @param {string} parameter_name
     * @param {number} param_value
     * @returns {any}
     */
    compute_equilibrium_eigenvalues(state, parameter_name, param_value) {
        const ptr0 = passArrayF64ToWasm0(state, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(parameter_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_compute_equilibrium_eigenvalues(this.__wbg_ptr, ptr0, len0, ptr1, len1, param_value);
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
}
if (Symbol.dispose) WasmSystem.prototype[Symbol.dispose] = WasmSystem.prototype.free;

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

function __wbg_get_imports() {
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
    imports.wbg.__wbg_set_c213c871859d6500 = function(arg0, arg1, arg2) {
        arg0[arg1 >>> 0] = arg2;
    };
    imports.wbg.__wbg_stack_0ed75d68575b0f3c = function(arg0, arg1) {
        const ret = arg1.stack;
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
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

    return imports;
}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedDataViewMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;


    wasm.__wbindgen_start();
    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();

    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }

    const instance = new WebAssembly.Instance(module, imports);

    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('fork_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync };
export default __wbg_init;
