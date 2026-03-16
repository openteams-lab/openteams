<div align="center">
  <img src="../frontend/public/openteams-brand-logo.png" alt="OpenTeams" width="320" style="margin-top: 20px; margin-bottom: 15px;">

  <p><strong>Ejecuta agentes como un equipo, multiplica tu eficiencia en la era de la IA.</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/openteams"><img alt="npm" src="https://img.shields.io/npm/v/openteams?style=flat-square" /></a>
    <a href="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml"><img alt="Build" src="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml/badge.svg" /></a>
    <a href="../LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
    <a href="https://discord.gg/MbgNFJeWDc"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
    <a href="https://docs.openteams.com/getting-started"><img alt="Platforms" src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-2EA44F?style=flat-square" /></a>
  </p>

  <p>
    <a href="https://your-demo-link.com">Ver demo</a> |
    <a href="#inicio-rápido">Inicio rápido</a> |
    <a href="https://docs.openteams.com">Documentación</a>
  </p>

  <p align="center">
    <a href="../README.md">English</a> |
    <a href="./README_zh-Hans.md">简体中文</a> |
    <a href="./README_zh-Hant.md">繁體中文</a> |
    <a href="./README_ja.md">日本語</a> |
    <a href="./README_ko.md">한국어</a> |
    <a href="./README_fr.md">Français</a> |
    <a href="./README_es.md">Español</a>
  </p>
</div>

---

![OpenTeams Demo](../images/demo.gif)

**Guía de inicio en un minuto**

1. Importa un equipo predefinido y elige el agente base para cada miembro.
2. Configura espacios de trabajo para cada miembro del equipo.
3. Envía un mensaje a un miembro específico con `@mentions`.

---

## Inicio rápido

### Opción A: Ejecutar con npx

```bash
# web
npx openteams-web
```

### Opción B: Descargar aplicación de escritorio

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for macOS](https://img.shields.io/badge/Download-macOS-000000?style=for-the-badge&logo=apple)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest)

### Requisitos

**Necesitarás al menos un agente de IA instalado:**

| Agent | Instalación |
|-------|---------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm i -g @anthropic-ai/claude-code` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm i -g @google/gemini-cli` |
| [Codex](https://github.com/openai/codex) | `npm i -g @openai/codex` |
| [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g @qwen-code/qwen-code` |
| [OpenCode](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g opencode-ai` |

📚 [Más guías de instalación de agentes](https://docs.openteams.com/getting-started)

---

## Funcionalidades

| Funcionalidad | Lo que obtienes |
|--|--|
| **Agentes soportados** | Soporta 10 runtimes de agentes de programación, incluyendo `Claude Code`, `Gemini CLI`, `Codex`, `Qwen Code`, `Amp`, `Cursor Agent`, `Copilot`, `Droid`, `Kimi Code` y `OpenCode`. Actualmente integrando otros agentes.|
| **Contexto de chat grupal compartido** | Cada participante trabaja desde el mismo historial de conversación en lugar de manejar prompts copiados entre ventanas separadas. |
| **Ejecución paralela** | Múltiples agentes pueden trabajar en la misma tarea al mismo tiempo dentro de una sesión compartida. Diferentes agentes manejan las tareas en las que son mejores. |
| **Colaboración autónoma** | Los agentes pueden `@mencionarse`, pasarse trabajo y coordinarse directamente en el chat. |
| **Miembros de IA integrados** | Comienza con más de 160 miembros de IA integrados en ingeniería, marketing, escritura, investigación y producción de contenido. |
| **Preajustes de equipo de IA integrados** | Lanza con 8 preajustes de equipo listos para usar para flujos de trabajo comunes. |
| **Directrices de equipo** | Define quién lidera, quién puede hablar con quién y cómo debe ocurrir la colaboración. Personaliza tu equipo de IA y las directrices del equipo. |
| **Biblioteca de habilidades** | Equipa agentes con más de 1000 habilidades integradas e importa tus propias habilidades cuando sea necesario. |
| **Ejecución completamente local** | Los agentes se ejecutan en tu espacio de trabajo local, y los artefactos de ejecución permanecen en `.openteams/` dentro de ese espacio. No hay preocupaciones sobre privacidad de datos. |

### Ejecución paralela de agentes

*Ejecuta múltiples agentes en el mismo contexto compartido y déjalos ejecutar en paralelo para acelerar la entrega.*

![OpenTeams parallel](../images/parallel.gif)

### Colaboración autónoma de agentes

*OpenTeams permite que los agentes se envíen mensajes directamente sin forzar un flujo de trabajo fijo. Si quieres más estructura, añade directrices de equipo para controlar la comunicación, designa un agente líder o deja que todos colaboren libremente. El patrón de comunicación depende enteramente de tu caso de uso.*

![OpenTeams collaborate](../images/collaborate.gif)

### Miembros de IA

*OpenTeams incluye más de 160 miembros de IA integrados en ingeniería, marketing, escritura, producción de contenido y más. Combínalos en diferentes equipos, personalízalos y construye combinaciones de roles que se adapten a tu forma de trabajar. Continuaremos expandiendo y mejorando el elenco.*

![OpenTeams members](../images/members.gif)

### Equipos de IA

*OpenTeams viene con 8 preajustes de equipo integrados para flujos de trabajo comunes, para que puedas comenzar inmediatamente. Recomendamos definir directrices de equipo al crear un equipo para que la colaboración se mantenga alineada con cómo quieres que opere el grupo.*

![OpenTeams team](../images/team.gif)

### Biblioteca de habilidades

*OpenTeams incluye más de 1000 habilidades integradas que puedes combinar y asignar a diferentes miembros de IA. También puedes importar habilidades que crees tú mismo y aplicarlas directamente a tus agentes. Continuaremos expandiendo la biblioteca de habilidades enfocándonos en capacidades que funcionen en entornos de producción reales.*

![OpenTeams skills](../images/skills.gif)

---

## Por qué somos mejores

Leyenda: ✅ Soporte completo | 🟡 Soporte parcial | ❌ Sin soporte

| **Capacidad** | Agente único tradicional | Flujo de trabajo multi-ventana | Claude Code Agent Team | OpenTeams |
|--|--|--|--|--|
| **Paralelismo**| ❌ No, secuencial | 🟡 Parcial, manual | ✅ Sí, subagentes Claude | ✅ Sí, automático |
| **Contexto compartido** | ❌ No | ❌ No, copiar y pegar | 🟡 Parcial, contextos de subagentes divididos | ✅ Sí, siempre sincronizado |
| **Colaboración multi-modelo** | ❌ No | 🟡 Parcial, cambio manual | ❌ No, solo Claude | ✅ Sí, Claude + Gemini + Codex + más |
| **Transferencia de agente** | ❌ No | ❌ No, tú orquestas | 🟡 Parcial, delegado dentro de Claude | ✅ Sí, `@mentions` directos |
| **Miembro de IA predefinido** | ❌ No | ❌ No | ❌ No | ✅ Sí, más de 160 miembros |
| **Gestor de equipo** | ❌ No | ❌ No | ❌ No | ✅ Sí, directrices de equipo personalizables |
| **Tu esfuerzo** | 🔴 Alto | 🔴 Muy alto | 🟠 Medio | 🟢 Bajo |

---

## Stack tecnológico

| Capa | Tecnología |
|-------|-----------|
| Frontend | React + TypeScript + Vite + Tailwind CSS |
| Backend | Rust |
| Desktop | Tauri |

## Desarrollo local

#### Mac/Linux

```bash
# 1. Clonar el repositorio
git clone https://github.com/openteams-lab/openteams.git
cd openteams

# 2. Instalar dependencias
pnpm i

# 3. Iniciar el servidor de desarrollo (ejecuta backend Rust + frontend React)
pnpm run dev

# 4. Construir frontend
pnpm --filter frontend build

# 5. Construir aplicación de escritorio
pnpm desktop:build
```

#### Windows (PowerShell): Iniciar backend y frontend por separado

`pnpm run dev` no puede ejecutarse en Windows PowerShell. Usa los siguientes comandos para iniciar backend y frontend por separado.

```bash
# 1. Clonar el repositorio
git clone https://github.com/openteams-lab/openteams.git
cd openteams

# 2. Instalar dependencias
pnpm i

# 3. Generar tipos TypeScript
pnpm run generate-types

# 4. Ejecutar migraciones de base de datos
pnpm run prepare-db
```

**Terminal A (backend)**

```powershell
$env:FRONTEND_PORT = node scripts/setup-dev-environment.js frontend
$env:BACKEND_PORT = node scripts/setup-dev-environment.js backend
$env:RUST_LOG = "debug"
cargo run --bin server
```

**Terminal B (frontend)**

```powershell
$env:FRONTEND_PORT = <puerto frontend generado desde terminal A>
$env:BACKEND_PORT = <puerto backend generado desde terminal A>
cd frontend
pnpm dev -- --port $env:FRONTEND_PORT --host
```

Abre la página frontend en `http://localhost:<FRONTEND_PORT>` (ejemplo: `http://localhost:3001`).

## Notas de versión y Hoja de ruta

### V0.2

- ~~[x] Chat grupal multi-agente con contexto compartido~~
- ~~[x] Ejecución paralela de agentes~~
- ~~[x] @mention de agentes y colaboración autónoma~~
- ~~[x] Soporte para 10 runtimes de agentes de programación (Claude Code, Gemini CLI, Codex, Qwen Code, Amp, Cursor Agent, Copilot, Droid, Kimi Code, OpenCode)~~
- ~~[x] Aplicaciones de escritorio (Windows, macOS, Linux)~~
- ~~[x] Aplicación web vía npx~~
- ~~[x] Soporte multilingüe (EN, ZH, JA, KO, FR, ES)~~

### V0.3

- ~~[x] Rediseño completo de la interfaz frontend~~
- ~~[x] Más de 160 miembros de IA integrados~~
- ~~[x] 8 preajustes de equipo de IA integrados~~
- ~~[x] Configuración de reglas de equipo~~
- ~~[x] Más de 1000 habilidades integradas~~
- ~~[x] Ejecución completamente local con aislamiento del espacio de trabajo~~
- ~~[x] Redefinición del protocolo de entrada~~

### Hoja de ruta

- [ ] Backend Code Agent optimizado para casos de uso de OpenTeams
- [ ] Establecer un marco de colaboración de equipo eficiente
- [ ] Más integraciones de agentes (Kilo Code, OpenClaw, etc.)
- [ ] Añadir equipos de IA más potentes listos para usar
- [ ] Añadir habilidades más potentes
- [ ] Desarrollar múltiples esquemas de color para la interfaz
- [ ] Ofrecer una versión altamente optimizada y personalizada


## Contribución

¡Las contribuciones son bienvenidas! Revisa lo que se necesita en [Issues](https://github.com/openteams-lab/openteams/issues) o inicia una [Discusión](https://github.com/openteams-lab/openteams/discussions).

1. Fork -> rama feature -> PR
2. Por favor abre un issue antes de cambios grandes
3. Por favor sigue nuestro [Código de conducta](../CODE_OF_CONDUCT.md)

## Comunidad

| | |
|--|--|
| **Reportes de bugs** | [GitHub Issues](https://github.com/openteams-lab/openteams/issues) |
| **Discusiones** | [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions) |
| **Chat comunitario** | [Discord](https://discord.gg/MbgNFJeWDc) |

## Agradecimientos

Construido sobre [Vibe Kanban](https://www.vibekanban.com/) - gracias a su equipo por la excelente base de código abierto.

Gracias también a [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) por ayudar a dar forma al ecosistema de habilidades integradas, y a [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) por la inspiración alrededor del diseño de roles de agentes y la composición de equipos.