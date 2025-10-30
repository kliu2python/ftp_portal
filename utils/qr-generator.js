'use strict';

const ECC_LEVELS = {
    M: {
        formatBits: 0
    }
};

const QR_VERSION_INFO = {
    1: { alignment: [] },
    2: { alignment: [6, 18] },
    3: { alignment: [6, 22] },
    4: { alignment: [6, 26] },
    5: { alignment: [6, 30] },
    6: { alignment: [6, 34] },
    7: { alignment: [6, 22, 38] },
    8: { alignment: [6, 24, 42] },
    9: { alignment: [6, 26, 46] },
    10: { alignment: [6, 28, 50] }
};

const ECC_BLOCK_INFO_M = {
    1: { eccPerBlock: 10, blocks: 1 },
    2: { eccPerBlock: 16, blocks: 1 },
    3: { eccPerBlock: 26, blocks: 1 },
    4: { eccPerBlock: 18, blocks: 2 },
    5: { eccPerBlock: 24, blocks: 2 },
    6: { eccPerBlock: 16, blocks: 4 },
    7: { eccPerBlock: 18, blocks: 4 },
    8: { eccPerBlock: 22, blocks: 4 },
    9: { eccPerBlock: 22, blocks: 5 },
    10: { eccPerBlock: 26, blocks: 5 }
};

const MAX_VERSION = 10;
const GF_EXP = new Array(512);
const GF_LOG = new Array(256);

(function initGaloisTables() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        GF_EXP[i] = x;
        GF_LOG[x] = i;
        x <<= 1;
        if (x & 0x100) {
            x ^= 0x11d;
        }
    }
    for (let i = 255; i < 512; i++) {
        GF_EXP[i] = GF_EXP[i - 255];
    }
})();

function gfMul(a, b) {
    if (a === 0 || b === 0) {
        return 0;
    }
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function polynomialMultiply(p, q) {
    const result = new Array(p.length + q.length - 1).fill(0);
    for (let i = 0; i < p.length; i++) {
        for (let j = 0; j < q.length; j++) {
            result[i + j] ^= gfMul(p[i], q[j]);
        }
    }
    return result;
}

function reedSolomonGenerator(degree) {
    let result = [1];
    for (let i = 0; i < degree; i++) {
        result = polynomialMultiply(result, [1, GF_EXP[i]]);
    }
    return result;
}

function reedSolomonRemainder(data, degree) {
    const generator = reedSolomonGenerator(degree);
    const coefficients = new Array(degree).fill(0);

    for (const value of data) {
        const lead = coefficients[0];
        for (let i = 0; i < degree - 1; i++) {
            coefficients[i] = coefficients[i + 1];
        }
        coefficients[degree - 1] = 0;
        const factor = value ^ lead;
        if (factor !== 0) {
            for (let i = 0; i < degree; i++) {
                coefficients[i] ^= gfMul(generator[i + 1], factor);
            }
        }
    }

    return coefficients;
}

function makeByteSegment(data, lengthBitCount) {
    const bits = [];
    // Mode indicator for byte mode: 0100
    pushBits(bits, 0b0100, 4);

    const length = data.length;
    pushBits(bits, length, lengthBitCount);

    for (let i = 0; i < data.length; i++) {
        pushBits(bits, data[i], 8);
    }

    return bits;
}

function pushBits(array, value, length) {
    for (let i = length - 1; i >= 0; i--) {
        array.push((value >>> i) & 1);
    }
}

function padBits(bits, totalDataCodewords) {
    const totalBits = totalDataCodewords * 8;

    const remaining = totalBits - bits.length;
    if (remaining < 0) {
        throw new Error('Data exceeds capacity');
    }

    // Terminator of up to 4 zeros
    const terminator = Math.min(4, remaining);
    for (let i = 0; i < terminator; i++) {
        bits.push(0);
    }

    // Pad to byte boundary
    const extra = (8 - (bits.length % 8)) % 8;
    for (let i = 0; i < extra; i++) {
        bits.push(0);
    }

    let padByte = 0xec;
    while (bits.length < totalBits) {
        pushBits(bits, padByte, 8);
        padByte = padByte === 0xec ? 0x11 : 0xec;
    }
}

function bitsToCodewords(bits) {
    const bytes = [];
    for (let i = 0; i < bits.length; i += 8) {
        let value = 0;
        for (let j = 0; j < 8; j++) {
            value = (value << 1) | bits[i + j];
        }
        bytes.push(value);
    }
    return bytes;
}

function getModuleCount(version) {
    return version * 4 + 17;
}

function initMatrix(size) {
    const modules = new Array(size);
    const isFunction = new Array(size);
    for (let y = 0; y < size; y++) {
        modules[y] = new Array(size).fill(null);
        isFunction[y] = new Array(size).fill(false);
    }
    return { modules, isFunction };
}

function drawFunctionPatterns(modules, isFunction, version) {
    const size = modules.length;

    // Finder patterns and separators
    const positions = [
        [0, 0],
        [size - 7, 0],
        [0, size - 7]
    ];

    for (const [x, y] of positions) {
        drawFinderPattern(modules, isFunction, x, y);
    }

    // Timing patterns
    for (let i = 0; i < size; i++) {
        const bit = i % 2 === 0;
        if (!isFunction[6][i]) {
            modules[6][i] = bit;
            isFunction[6][i] = true;
        }
        if (!isFunction[i][6]) {
            modules[i][6] = bit;
            isFunction[i][6] = true;
        }
    }

    // Alignment patterns
    const alignment = QR_VERSION_INFO[version].alignment || [];
    for (let i = 0; i < alignment.length; i++) {
        for (let j = 0; j < alignment.length; j++) {
            const cx = alignment[i];
            const cy = alignment[j];
            if (isFinderCenter(size, cx, cy)) {
                continue;
            }
            drawAlignmentPattern(modules, isFunction, cx - 2, cy - 2);
        }
    }

    // Dark module
    modules[size - 8][8] = true;
    isFunction[size - 8][8] = true;

    reserveFormatAreas(modules, isFunction);

    if (version >= 7) {
        drawVersionInformation(modules, isFunction, version);
    }
}

function isFinderCenter(size, x, y) {
    const max = size - 7;
    return (x === 6 && y === 6) ||
        (x === 6 && y === max) ||
        (x === max && y === 6);
}

function drawFinderPattern(modules, isFunction, x, y) {
    for (let dy = 0; dy < 7; dy++) {
        for (let dx = 0; dx < 7; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            const value = Math.max(Math.abs(dx - 3), Math.abs(dy - 3)) <= 1;
            modules[yy][xx] = value;
            isFunction[yy][xx] = true;
        }
    }

    // Separators
    for (let i = -1; i <= 7; i++) {
        if (isInside(modules.length, x - 1, y + i)) {
            modules[y + i][x - 1] = false;
            isFunction[y + i][x - 1] = true;
        }
        if (isInside(modules.length, x + 7, y + i)) {
            modules[y + i][x + 7] = false;
            isFunction[y + i][x + 7] = true;
        }
        if (isInside(modules.length, x + i, y - 1)) {
            modules[y - 1][x + i] = false;
            isFunction[y - 1][x + i] = true;
        }
        if (isInside(modules.length, x + i, y + 7)) {
            modules[y + 7][x + i] = false;
            isFunction[y + 7][x + i] = true;
        }
    }
}

function drawAlignmentPattern(modules, isFunction, x, y) {
    for (let dy = 0; dy < 5; dy++) {
        for (let dx = 0; dx < 5; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            const value = Math.max(Math.abs(dx - 2), Math.abs(dy - 2)) !== 1;
            modules[yy][xx] = value;
            isFunction[yy][xx] = true;
        }
    }
}

function reserveFormatAreas(modules, isFunction) {
    const size = modules.length;
    for (let i = 0; i < 9; i++) {
        if (i !== 6) {
            isFunction[8][i] = true;
            modules[8][i] = false;
        }
        if (i !== 6) {
            isFunction[i][8] = true;
            modules[i][8] = false;
        }
    }
    for (let i = size - 8; i < size; i++) {
        isFunction[8][i] = true;
        modules[8][i] = false;
        isFunction[i][8] = true;
        modules[i][8] = false;
    }
}

function drawVersionInformation(modules, isFunction, version) {
    const size = modules.length;
    let remainder = version << 12;
    const generator = 0x1f25;
    for (let i = 0; i < 12; i++) {
        if ((remainder & (1 << (17 - i))) !== 0) {
            remainder ^= generator << (11 - i);
        }
    }
    const bits = (version << 12) | (remainder & 0xfff);
    for (let i = 0; i < 18; i++) {
        const bit = ((bits >> i) & 1) === 1;
        const x = Math.floor(i / 3);
        const y = i % 3;
        modules[y][size - 11 + x] = bit;
        isFunction[y][size - 11 + x] = true;
        modules[size - 11 + x][y] = bit;
        isFunction[size - 11 + x][y] = true;
    }
}

function isInside(size, x, y) {
    return x >= 0 && y >= 0 && x < size && y < size;
}

function getRawCodewordCapacity(modules, isFunction) {
    let count = 0;
    for (let y = 0; y < modules.length; y++) {
        for (let x = 0; x < modules.length; x++) {
            if (!isFunction[y][x]) {
                count++;
            }
        }
    }
    return count / 8;
}

function placeDataBits(modules, isFunction, dataBits) {
    const size = modules.length;
    let bitIndex = 0;
    let directionUp = true;

    for (let x = size - 1; x >= 1; x -= 2) {
        if (x === 6) {
            x--;
        }
        for (let yOffset = 0; yOffset < size; yOffset++) {
            const y = directionUp ? size - 1 - yOffset : yOffset;
            for (let dx = 0; dx < 2; dx++) {
                const xx = x - dx;
                if (!isFunction[y][xx]) {
                    const bit = bitIndex < dataBits.length ? dataBits[bitIndex] === 1 : false;
                    modules[y][xx] = bit;
                    bitIndex++;
                }
            }
        }
        directionUp = !directionUp;
    }
}

function applyMask(modules, isFunction, mask) {
    const size = modules.length;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (isFunction[y][x]) {
                continue;
            }
            if (maskCondition(mask, x, y)) {
                modules[y][x] = !modules[y][x];
            }
        }
    }
}

function maskCondition(mask, x, y) {
    switch (mask) {
        case 0: return (x + y) % 2 === 0;
        case 1: return y % 2 === 0;
        case 2: return x % 3 === 0;
        case 3: return (x + y) % 3 === 0;
        case 4: return ((Math.floor(y / 2) + Math.floor(x / 3)) % 2) === 0;
        case 5: return (((x * y) % 2) + ((x * y) % 3)) === 0;
        case 6: return ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0;
        case 7: return ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0;
        default: return false;
    }
}

function drawFormatBits(modules, isFunction, mask) {
    const size = modules.length;
    const base = ECC_LEVELS.M.formatBits << 3 | mask;
    let data = base << 10;
    for (let i = 0; i < 10; i++) {
        if ((data & (1 << (14 - i))) !== 0) {
            data ^= 0x537 << (9 - i);
        }
    }
    const bits = ((base << 10) | data) ^ 0x5412;

    for (let i = 0; i < 6; i++) {
        setFunctionModule(modules, isFunction, 8, i, (bits >> i) & 1);
    }
    setFunctionModule(modules, isFunction, 8, 6, (bits >> 6) & 1);
    setFunctionModule(modules, isFunction, 8, 7, (bits >> 7) & 1);
    setFunctionModule(modules, isFunction, 8, 8, (bits >> 8) & 1);
    setFunctionModule(modules, isFunction, 7, 8, (bits >> 9) & 1);
    for (let i = 10; i < 15; i++) {
        setFunctionModule(modules, isFunction, 14 - i, 8, (bits >> i) & 1);
    }

    for (let i = 0; i < 8; i++) {
        setFunctionModule(modules, isFunction, size - 1 - i, 8, (bits >> i) & 1);
    }
    for (let i = 8; i < 15; i++) {
        setFunctionModule(modules, isFunction, 8, size - 15 + i, (bits >> i) & 1);
    }
    modules[size - 8][8] = true;
}

function setFunctionModule(modules, isFunction, x, y, bit) {
    modules[y][x] = bit === 1;
    isFunction[y][x] = true;
}

function evaluatePenalty(modules) {
    return penaltyRule1(modules) +
        penaltyRule2(modules) +
        penaltyRule3(modules) +
        penaltyRule4(modules);
}

function penaltyRule1(modules) {
    const size = modules.length;
    let penalty = 0;
    for (let y = 0; y < size; y++) {
        let runColor = modules[y][0];
        let runLength = 1;
        for (let x = 1; x < size; x++) {
            if (modules[y][x] === runColor) {
                runLength++;
            } else {
                if (runLength >= 5) {
                    penalty += 3 + (runLength - 5);
                }
                runColor = modules[y][x];
                runLength = 1;
            }
        }
        if (runLength >= 5) {
            penalty += 3 + (runLength - 5);
        }
    }

    for (let x = 0; x < size; x++) {
        let runColor = modules[0][x];
        let runLength = 1;
        for (let y = 1; y < size; y++) {
            if (modules[y][x] === runColor) {
                runLength++;
            } else {
                if (runLength >= 5) {
                    penalty += 3 + (runLength - 5);
                }
                runColor = modules[y][x];
                runLength = 1;
            }
        }
        if (runLength >= 5) {
            penalty += 3 + (runLength - 5);
        }
    }
    return penalty;
}

function penaltyRule2(modules) {
    const size = modules.length;
    let penalty = 0;
    for (let y = 0; y < size - 1; y++) {
        for (let x = 0; x < size - 1; x++) {
            const color = modules[y][x];
            if (color === modules[y][x + 1] &&
                color === modules[y + 1][x] &&
                color === modules[y + 1][x + 1]) {
                penalty += 3;
            }
        }
    }
    return penalty;
}

function penaltyRule3(modules) {
    const size = modules.length;
    const patterns = [
        [true, false, true, true, true, false, true, false, false, false, false],
        [false, false, false, false, true, false, true, true, true, false, true]
    ];
    let penalty = 0;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x <= size - 11; x++) {
            const slice = modules[y].slice(x, x + 11);
            if (matchesPattern(slice, patterns[0]) || matchesPattern(slice, patterns[1])) {
                penalty += 40;
            }
        }
    }

    for (let x = 0; x < size; x++) {
        for (let y = 0; y <= size - 11; y++) {
            const slice = [];
            for (let i = 0; i < 11; i++) {
                slice.push(modules[y + i][x]);
            }
            if (matchesPattern(slice, patterns[0]) || matchesPattern(slice, patterns[1])) {
                penalty += 40;
            }
        }
    }

    return penalty;
}

function matchesPattern(slice, pattern) {
    for (let i = 0; i < pattern.length; i++) {
        if (!!slice[i] !== pattern[i]) {
            return false;
        }
    }
    return true;
}

function penaltyRule4(modules) {
    const size = modules.length;
    let dark = 0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (modules[y][x]) {
                dark++;
            }
        }
    }
    const total = size * size;
    const ratio = Math.abs(dark * 20 - total * 10) / total;
    return Math.floor(ratio) * 10;
}

function cloneMatrix(matrix) {
    return matrix.map(row => row.slice());
}

function renderSvg(modules, options = {}) {
    const margin = options.margin ?? 2;
    const scale = options.moduleScale ?? 8;
    const size = modules.length + margin * 2;
    const path = [];

    for (let y = 0; y < modules.length; y++) {
        for (let x = 0; x < modules.length; x++) {
            if (modules[y][x]) {
                path.push(`M${x + margin} ${y + margin}h1v1h-1z`);
            }
        }
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size * scale}" height="${size * scale}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
        `<rect width="100%" height="100%" fill="#ffffff"/>` +
        `<path d="${path.join('')}" fill="#000000"/>` +
        `</svg>`;

    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function chooseVersion(dataLength) {
    for (let version = 1; version <= MAX_VERSION; version++) {
        const { modules, isFunction } = initMatrix(getModuleCount(version));
        drawFunctionPatterns(modules, isFunction, version);
        const info = ECC_BLOCK_INFO_M[version];
        if (!info) {
            break;
        }
        const { eccPerBlock, blocks } = info;
        const capacity = getRawCodewordCapacity(modules, isFunction) - eccPerBlock * blocks;
        if (capacity >= dataLength) {
            return version;
        }
    }
    throw new Error('Data too long to encode with available versions');
}

function buildMatrix(data, versionInfo) {
    const version = versionInfo.version;
    const size = getModuleCount(version);
    const { modules, isFunction } = initMatrix(size);
    drawFunctionPatterns(modules, isFunction, version);

    const { eccPerBlock, blocks } = versionInfo;
    const capacity = getRawCodewordCapacity(modules, isFunction) - eccPerBlock * blocks;

    const bits = makeByteSegment(data.slice(), versionInfo.lengthBits);
    padBits(bits, capacity);
    const dataCodewords = bitsToCodewords(bits);

    const shortBlockLength = Math.floor(dataCodewords.length / blocks);
    const numLongBlocks = dataCodewords.length % blocks;
    const blocksData = [];
    let offset = 0;
    for (let i = 0; i < blocks; i++) {
        const blockLength = shortBlockLength + (i < numLongBlocks ? 1 : 0);
        const block = dataCodewords.slice(offset, offset + blockLength);
        offset += blockLength;
        const ecc = reedSolomonRemainder(block, eccPerBlock);
        blocksData.push({ data: block, ecc });
    }

    const interleaved = [];
    const maxBlockLength = Math.max(...blocksData.map(block => block.data.length));
    for (let i = 0; i < maxBlockLength; i++) {
        for (const block of blocksData) {
            if (i < block.data.length) {
                interleaved.push(block.data[i]);
            }
        }
    }
    for (let i = 0; i < eccPerBlock; i++) {
        for (const block of blocksData) {
            interleaved.push(block.ecc[i]);
        }
    }

    const interleavedBits = [];
    for (const value of interleaved) {
        pushBits(interleavedBits, value, 8);
    }

    placeDataBits(modules, isFunction, interleavedBits);

    let bestPenalty = Infinity;
    let bestModules = null;
    for (let mask = 0; mask < 8; mask++) {
        const maskedModules = cloneMatrix(modules);
        applyMask(maskedModules, isFunction, mask);
        drawFormatBits(maskedModules, isFunction, mask);
        const penalty = evaluatePenalty(maskedModules);
        if (penalty < bestPenalty) {
            bestPenalty = penalty;
            bestModules = maskedModules;
        }
    }

    if (!bestModules) {
        throw new Error('Unable to generate QR mask');
    }

    return { modules: bestModules, size };
}

function generateQrDataUrl(text, options = {}) {
    if (typeof text !== 'string' || text.length === 0) {
        throw new Error('QR text must be a non-empty string');
    }

    const level = options.errorCorrectionLevel ? String(options.errorCorrectionLevel).toUpperCase() : 'M';
    if (level !== 'M') {
        throw new Error('Only error correction level M is supported in this generator');
    }

    const data = Buffer.from(text, 'utf8');
    const version = chooseVersion(data.length);
    const versionInfo = {
        version,
        lengthBits: version <= 9 ? 8 : 16,
        ...ECC_BLOCK_INFO_M[version]
    };

    const { modules } = buildMatrix(data, versionInfo);
    return renderSvg(modules, { margin: options.margin, moduleScale: options.moduleScale });
}

module.exports = {
    generateQrDataUrl
};
