import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fitWithin as fitInInterface } from '../src/lib/imageResize';

const require = createRequire(import.meta.url);
const { fitWithin } = require('../electron/services/imageService');
const pkg = require('../package.json');

function filesUnder(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

describe('image resizing', () => {
    for (const [name, fit] of [['main process', fitWithin], ['interface', fitInInterface]]) {
        it(`fits in the box and keeps the proportions (${name})`, () => {
            expect(fit(4000, 3000, 800)).toEqual({ width: 800, height: 600 });
            expect(fit(1080, 1920, 800)).toEqual({ width: 450, height: 800 });
            expect(fit(600, 600, 600)).toEqual({ width: 600, height: 600 });
        });
        it(`never enlarges a small image (${name})`, () => {
            expect(fit(320, 200, 800)).toEqual({ width: 320, height: 200 });
        });
    }
});

describe('no native image library in the application', () => {
    it('sharp is only a development tool (icons script)', () => {
        expect(pkg.dependencies.sharp).toBeUndefined();
        expect(pkg.devDependencies.sharp).toBeDefined();
        const uses = [...filesUnder('electron'), ...filesUnder('src')]
            .filter(f => /\.(js|jsx)$/.test(f) && /require\(['"]sharp['"]\)|from ['"]sharp['"]/.test(fs.readFileSync(f, 'utf8')));
        expect(uses).toEqual([]);
    });
    it('nothing has to be unpacked from app.asar', () => {
        expect(pkg.build.asarUnpack).toBeUndefined();
    });
});
