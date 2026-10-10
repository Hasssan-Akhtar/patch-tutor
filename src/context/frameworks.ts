export interface ManifestFiles {
  packageJson?: string;
  requirementsTxt?: string;
  pyprojectToml?: string;
  goMod?: string;
}

const JS_FRAMEWORKS: Record<string, string> = {
  react: 'React',
  next: 'Next.js',
  vue: 'Vue',
  nuxt: 'Nuxt',
  svelte: 'Svelte',
  '@angular/core': 'Angular',
  express: 'Express',
  fastify: 'Fastify',
  '@nestjs/core': 'NestJS',
  koa: 'Koa',
  prisma: 'Prisma',
  '@prisma/client': 'Prisma',
  'drizzle-orm': 'Drizzle',
  typeorm: 'TypeORM',
  sequelize: 'Sequelize',
  mongoose: 'Mongoose',
  vitest: 'Vitest',
  jest: 'Jest',
  'react-native': 'React Native',
  electron: 'Electron',
  '@types/vscode': 'VS Code extension API',
};

const PY_FRAMEWORKS: Record<string, string> = {
  django: 'Django',
  flask: 'Flask',
  fastapi: 'FastAPI',
  sqlalchemy: 'SQLAlchemy',
  pydantic: 'Pydantic',
  pandas: 'pandas',
  numpy: 'NumPy',
  pytest: 'pytest',
  torch: 'PyTorch',
};

const GO_FRAMEWORKS: Record<string, string> = {
  'github.com/gin-gonic/gin': 'Gin',
  'github.com/labstack/echo': 'Echo',
  'github.com/gofiber/fiber': 'Fiber',
  'github.com/go-chi/chi': 'chi',
  'gorm.io/gorm': 'GORM',
};

/** Names well-known frameworks found in the project's dependency manifests. */
export function detectFrameworks(files: ManifestFiles): string[] {
  const found = new Set<string>();

  if (files.packageJson) {
    for (const dep of packageJsonDependencies(files.packageJson)) {
      const name = JS_FRAMEWORKS[dep];
      if (name) {
        found.add(name);
      }
    }
  }

  const pythonText = [files.requirementsTxt, files.pyprojectToml].filter(Boolean).join('\n');
  for (const name of pythonPackageNames(pythonText)) {
    const framework = PY_FRAMEWORKS[name];
    if (framework) {
      found.add(framework);
    }
  }

  if (files.goMod) {
    for (const [module, name] of Object.entries(GO_FRAMEWORKS)) {
      if (files.goMod.includes(module)) {
        found.add(name);
      }
    }
  }

  return [...found].sort();
}

function packageJsonDependencies(text: string): string[] {
  try {
    const pkg = JSON.parse(text) as Record<string, unknown>;
    return ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((field) => {
      const deps = pkg[field];
      return deps && typeof deps === 'object' ? Object.keys(deps) : [];
    });
  } catch {
    return [];
  }
}

function pythonPackageNames(text: string): Set<string> {
  // Matches "django>=4", "  'fastapi[all]'," and similar; good enough for hints.
  const names = text.toLowerCase().match(/[a-z][a-z0-9_-]*/g) ?? [];
  return new Set(names);
}
