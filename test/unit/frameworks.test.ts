import { describe, expect, it } from 'vitest';
import { detectFrameworks } from '../../src/context/frameworks';
import { languageFromPath } from '../../src/context/language';

describe('detectFrameworks', () => {
  it('reads all dependency fields of package.json', () => {
    const packageJson = JSON.stringify({
      dependencies: { react: '^19', express: '^5' },
      devDependencies: { vitest: '^5' },
    });

    expect(detectFrameworks({ packageJson })).toEqual(['Express', 'React', 'Vitest']);
  });

  it('reads Python requirements and pyproject files', () => {
    expect(
      detectFrameworks({
        requirementsTxt: 'Django>=5.0\nrequests==2.32\n',
        pyprojectToml: 'dependencies = ["fastapi[all]>=0.110"]',
      }),
    ).toEqual(['Django', 'FastAPI']);
  });

  it('reads go.mod modules', () => {
    const goMod = 'module example.com/app\n\nrequire github.com/gin-gonic/gin v1.10.0\n';

    expect(detectFrameworks({ goMod })).toEqual(['Gin']);
  });

  it('ignores invalid package.json and missing files', () => {
    expect(detectFrameworks({ packageJson: '{ not json' })).toEqual([]);
    expect(detectFrameworks({})).toEqual([]);
  });
});

describe('languageFromPath', () => {
  it('maps common extensions and falls back to plaintext', () => {
    expect(languageFromPath('src/a.ts')).toBe('typescript');
    expect(languageFromPath('app/models.PY')).toBe('python');
    expect(languageFromPath('Makefile')).toBe('plaintext');
  });
});
