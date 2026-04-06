<div align="center">
  <img src="../frontend/public/Logo/logo_blue.svg" alt="OpenTeams" width="200">
</div>

<div align="center">
  <img src="../frontend/public/openteams-brand-logo.png" alt="OpenTeams" width="320" style="margin-top: 10px; margin-bottom: 10px;">
  
  <p><strong>Haz que los agentes trabajen como un solo equipo y multiplica tu eficiencia en la era de la IA.</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/openteams-web"><img alt="npm" src="https://img.shields.io/npm/v/openteams-web?style=flat-square" /></a>
    <a href="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml"><img alt="Build" src="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml/badge.svg" /></a>
    <a href="../LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
    <a href="https://discord.gg/MbgNFJeWDc"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
    <a href="https://doc.openteams-lab.com/getting-started"><img alt="Platforms" src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-2EA44F?style=flat-square" /></a>
  </p>

  <p>
    <a href="#inicio-rápido">Inicio rápido</a> |
    <a href="https://doc.openteams-lab.com">Documentación</a> 
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

![OpenTeams Demo](images/demo.gif)

**Guía de inicio en un minuto**

1. Importa un equipo predefinido y elige el Agent base para cada miembro.
2. Configura un espacio de trabajo para cada miembro del equipo.
3. Envía un mensaje a un miembro específico con `@member`.

---
## 🔥 *Novedades:*
### *Actualizaciones importantes*
- **2026.04.02 (v0.3.11)**
  - Se habilitó el modo de interfaz oscura
  - Se corrigieron problemas de concurrencia en openteams-cli
- **2026.04.02 (v0.3.10)**
  - Se implementó la actualización de versión dentro de la app
  - El sitio de documentación ya está disponible.
- **2026.03.24 (v0.3.7)**: 
  - Se añadió el Agent openteams-CLI integrado, eliminando la dependencia de una instalación local del Agent.
  - Se corrigió una fuga de memoria en el ejecutor.
---

## Inicio rápido

### Opción A: Ejecutar con npx
**Este método de instalación se recomienda para Mac y Linux.**

```bash
# web
npx openteams-web
```

### Opción B: Descargar la aplicación de escritorio

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest)

### Requisitos

**Desde la v0.3.7, openteams-cli viene integrado, así que ya no hace falta instalar un AI Agent por separado. Puedes configurar tu API en la página `Settings -> Service Providers`.**

⚙️ [Consulta la documentación de configuración de proveedores.](https://doc.openteams-lab.com/advanced-usage/custom-provider)

También puedes elegir cualquier Agent de la lista de Agents compatibles.

| Agent | Instalación |
|-------|---------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm i -g @anthropic-ai/claude-code` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm i -g @google/gemini-cli` |
| [Codex](https://github.com/openai/codex) | `npm i -g @openai/codex` |
| [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g @qwen-code/qwen-code` |
| [OpenCode](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g opencode-ai` |

📚 [Más guías de instalación de Agent](https://doc.openteams-lab.com/getting-started)

---

## Funcionalidades

| Funcionalidad | Lo que obtienes |
|--|--|
| **Agents compatibles** | Soporta 10 runtimes de Agents de programación, incluidos `Claude Code`, `Gemini CLI`, `Codex`, `Qwen Code`, `Amp`, `Cursor Agent`, `Copilot`, `Droid`, `Kimi Code` y `OpenCode`. También se están integrando más Agents.|
| **Contexto compartido de chat grupal** | Todos los participantes trabajan sobre el mismo historial de conversación, sin tener que copiar y pegar prompts entre ventanas separadas. |
| **Ejecución en paralelo** | Varios Agents pueden trabajar al mismo tiempo sobre la misma tarea dentro de una sesión compartida. Cada Agent se encarga de la parte en la que mejor rinde. |
| **Colaboración autónoma** | Los Agents pueden `@mention` entre sí, pasarse trabajo y coordinarse directamente dentro del chat. |
| **Miembros de IA integrados** | Empieza de inmediato con más de 160 miembros de IA integrados en ingeniería, marketing, redacción, investigación y producción de contenido. |
| **Equipos de IA predefinidos** | Incluye 8 equipos listos para usar para flujos de trabajo comunes. |
| **Guías de colaboración del equipo** | Puedes definir quién lidera, quién puede hablar con quién y cómo debe llevarse a cabo la colaboración. Personaliza tu equipo de IA y sus reglas según tu forma de trabajar. |
| **Biblioteca de habilidades** | Equipa a los Agents con más de 1000 habilidades integradas e importa tus propias habilidades cuando lo necesites. |
| **Ejecución completamente local** | Los Agents se ejecutan directamente sobre tu espacio de trabajo local y los artefactos de ejecución se guardan dentro de `.openteams/` en ese mismo espacio. No tienes que preocuparte por la privacidad de los datos. |

### Ejecución paralela de Agents

*Ejecuta varios Agents dentro del mismo contexto compartido y deja que trabajen en paralelo para acelerar la entrega.*

![OpenTeams parallel](images/parallel.gif)

### Colaboración autónoma entre Agents

*OpenTeams permite que los Agents se envíen mensajes directamente sin imponer un flujo de trabajo fijo. Si quieres más estructura, puedes añadir guías de equipo para controlar la comunicación, nombrar un Agent líder o dejar que todos colaboren libremente. El patrón de comunicación depende por completo de tu caso de uso.*

![OpenTeams collaborate](images/collaborate.gif)

### Miembros de IA

*OpenTeams incluye más de 160 miembros de IA integrados que cubren ingeniería, marketing, redacción, producción de contenido y mucho más. Puedes combinarlos en distintos equipos, personalizarlos y construir configuraciones de roles que encajen con tu forma de trabajar. Seguiremos ampliando y mejorando esta selección de miembros.*

![OpenTeams members](images/members.gif)

### Equipos de IA

*OpenTeams incluye 8 equipos predefinidos para flujos de trabajo habituales, de modo que puedas empezar de inmediato. Recomendamos definir las guías del equipo al crearlo para que la colaboración se mantenga alineada con la forma en que quieres que funcione el grupo.*

![OpenTeams team](images/team.gif)

### Biblioteca de habilidades

*OpenTeams incluye más de 1000 habilidades integradas que puedes combinar y asignar a distintos miembros de IA. También puedes importar habilidades creadas por ti y aplicarlas directamente a tus Agents. Seguiremos ampliando la biblioteca con foco en capacidades que realmente funcionen en entornos de producción.*

![OpenTeams skills](images/skills.gif)

---

## Por qué OpenTeams es más fuerte

Leyenda: ✅ Soporte completo | 🟡 Soporte parcial | ❌ Sin soporte

| **Capacidad** | Agent único tradicional | Flujo de trabajo con varias ventanas | Claude Code Agent Team | openteams |
|--|--|--|--|--|
| **Paralelismo**| ❌ No, solo secuencial | 🟡 Parcial, manual | ✅ Sí, subagentes de Claude | ✅ Sí, automático |
| **Contexto compartido** | ❌ No | ❌ No, requiere copiar y pegar | 🟡 Parcial, contextos de subagentes separados | ✅ Sí, siempre sincronizado |
| **Colaboración multimodelo** | ❌ No | 🟡 Parcial, cambio manual | ❌ No, solo Claude | ✅ Sí, Claude + Gemini + Codex + más |
| **Traspaso entre Agents** | ❌ No | ❌ No, tú haces la orquestación | 🟡 Parcial, delegación dentro de Claude | ✅ Sí, `@mentions` directos |
| **Miembros de IA predefinidos** | ❌ No | ❌ No | ❌ No | ✅ Sí, más de 160 miembros |
| **Gestión del equipo** | ❌ No | ❌ No | ❌ No | ✅ Sí, guías de equipo personalizables |
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
# 1. Clona el repositorio
git clone https://github.com/openteams-lab/openteams.git
cd openteams

# 2. Instala dependencias
pnpm i

# 3. Inicia el servidor de desarrollo (backend Rust + frontend React)
pnpm run dev

# 4. Compila el frontend
pnpm --filter frontend build

# 5. Compila la aplicación de escritorio
pnpm desktop:build
```

#### Windows (PowerShell): inicia backend y frontend por separado

`pnpm run dev` no puede ejecutarse en Windows PowerShell. Usa los siguientes comandos para iniciar el backend y el frontend por separado.

```bash
# 1. Clona el repositorio
git clone https://github.com/openteams-lab/openteams.git
cd openteams

# 2. Instala dependencias
pnpm i

# 3. Genera los tipos TypeScript
pnpm run generate-types

# 4. Ejecuta las migraciones de base de datos
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
$env:FRONTEND_PORT = <puerto frontend generado desde la terminal A>
$env:BACKEND_PORT = <puerto backend generado desde la terminal A>
cd frontend
pnpm dev -- --port $env:FRONTEND_PORT --host
```

Abre el frontend en `http://localhost:<FRONTEND_PORT>` (por ejemplo: `http://localhost:3001`).

#### Compilar `openteams-cli` en local

Si necesitas compilar el binario local de `openteams-cli` en lugar de usar la versión integrada o una build publicada, utiliza los siguientes comandos.
Los artefactos de compilación se colocarán en el directorio binaries.

```bash
# Desde la raíz del repositorio
bun run ./scripts/build-openteams-cli.ts
```

## Notas de versión y hoja de ruta

### V0.2

- [x] Chat grupal multi-Agent con contexto compartido
- [x] Ejecución paralela de Agents
- [x] `@mention` entre Agents y colaboración autónoma
- [x] Soporte para 10 runtimes de Agents de programación (Claude Code, Gemini CLI, Codex, Qwen Code, Amp, Cursor Agent, Copilot, Droid, Kimi Code, OpenCode)
- [x] Aplicaciones de escritorio (Windows, macOS, Linux)
- [x] Aplicación web ejecutable vía npx
- [x] Soporte multilingüe (EN, ZH, JA, KO, FR, ES)

### V0.3
- [x] Rediseño completo de la interfaz frontend
- [x] Más de 160 miembros de IA integrados
- [x] 8 equipos de IA predefinidos
- [x] Configuración de reglas del equipo
- [x] Más de 1000 habilidades integradas
- [x] Ejecución completamente local con aislamiento del espacio de trabajo
- [x] Redefinición del protocolo de entrada

### Hoja de ruta
- [x] Backend Code Agent optimizado para los casos de uso de OpenTeams —— v0.3.7
- [x] Desarrollo de múltiples esquemas de color para el frontend —— v0.3.11
- [ ] Crear un marco de colaboración en equipo de alta eficiencia
- [ ] Integrar más Agents (Kilo Code, OpenClaw, etc.)
- [ ] Añadir más equipos de IA potentes listos para usar
- [ ] Añadir habilidades más potentes
- [ ] Ofrecer una versión altamente optimizada y personalizada


## Contribuir

Las contribuciones son bienvenidas. Revisa lo que hace falta en [Issues](https://github.com/StarterraAI/OpenTeams/issues) o abre una [Discussion](https://github.com/StarterraAI/OpenTeams/discussions).

1. Fork -> crea una rama feature -> abre una PR
2. Abre un issue antes de hacer cambios grandes
3. Sigue nuestro [Código de conducta](../CODE_OF_CONDUCT.md)

### Formato de código

Antes de enviar una PR, asegúrate de que el código esté correctamente formateado.

```bash
# Formatea frontend y backend
pnpm run format

# Verifica el formato sin modificar archivos
pnpm run format:check

# Formatea solo el frontend
pnpm run frontend:format

# Formatea solo el backend (Rust)
pnpm run backend:format
```

**Nota:** la CI fallará si el formato del código no es correcto. Ejecuta siempre `pnpm run format:check` antes de hacer push.

## Comunidad

| | |
|--|--|
| **Reporte de bugs** | [GitHub Issues](https://github.com/openteams-lab/openteams/issues) |
| **Discusiones** | [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions) |
| **Chat de la comunidad** | [Discord](https://discord.gg/MbgNFJeWDc) |

## Agradecimientos

Este proyecto está construido sobre [Vibe Kanban](https://www.vibekanban.com/). Gracias a su equipo por la excelente base open source.

Gracias también a [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) por ayudar a dar forma al ecosistema de habilidades integradas, y a [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) por la inspiración en el diseño de roles de Agent y la composición de equipos.
