<div align="center">
  <img src="images/openteams-logo.png" alt="openteams" width="100">
</div>

<div align="center">
  <img src="images/characters_black.png" alt="openteams" width="200" style="margin-top: 10px; margin-bottom: 10px;">

  <h5>Planifica, construye y entrega — con un equipo de agentes de IA en lugar de uno solo</h5>

  <p>
    openteams es una aplicación de escritorio de IA, de código abierto y local-first, que ayuda a desarrolladores independientes a planificar, construir y entregar software más rápido con un equipo de IA bajo su control.
  </p>

  <p>
    <a href="https://www.npmjs.com/package/openteams-web"><img alt="npm" src="https://img.shields.io/npm/v/openteams-web?style=flat-square" /></a>
    <a href="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml"><img alt="Build" src="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml/badge.svg" /></a>
    <a href="../LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
    <a href="https://discord.gg/MbgNFJeWDc"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
    <a href="images/openteams-wechat-community.png"><img alt="WeChat" src="https://img.shields.io/badge/WeChat-Join%20Group-07C160?style=flat-square&logo=wechat&logoColor=white" /></a>
    <a href="images/openteams-feishu-community.png"><img alt="Feishu/Lark" src="https://img.shields.io/badge/Feishu%2FLark-Join%20Group-3370FF?style=flat-square" /></a>
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
<div align="center">
  <video src="https://github.com/user-attachments/assets/fdf0ef91-5b02-4302-bdec-087c1995a590" controls autoplay muted playsinline width="100%">
    <a href="https://github.com/user-attachments/assets/fdf0ef91-5b02-4302-bdec-087c1995a590">Ver el video del producto</a>
  </video>
</div>

## ¿Qué es exactamente openteams?

Ya usas Claude Code, Codex, Gemini CLI u otro agente de código. Cada uno funciona bien por separado. Entonces abres un segundo terminal y después un tercero. Repites el mismo contexto, llevas resultados de una ventana a otra y recuerdas quién está cambiando cada cosa. En poco tiempo, terminas gestionando a los agentes en lugar del trabajo: los cambios están repartidos entre sesiones, las prioridades del proyecto están en otro sitio y el uso de tokens no está conectado con lo que realmente se entregó.

openteams aporta lo que falta alrededor de esos agentes: **una sala compartida donde pueden hablar y pasarse trabajo, un plan que puedes ver y controlar, y un registro local y ligero que conecta las tareas del proyecto con los resultados de los agentes sin entregarles el control de la hoja de ruta.**

| openteams **es** | openteams **no es** |
| --- | --- |
| un espacio de trabajo local-first que conecta los agentes de código que ya utilizas | otro modelo o un sustituto de Claude Code, Codex o Gemini CLI |
| una sesión compartida donde los agentes pueden hablar, pasarse trabajo y mantener el mismo contexto | una colección de chats separados que todavía tienes que coordinar a mano |
| una lista de issues controlada por el desarrollador y vinculada a las sesiones de los agentes | una suite completa de gestión de proyectos o una hoja de ruta que los agentes reescriben |
| un flujo de trabajo que puedes revisar, interrumpir y reintentar paso a paso | un gran prompt que permanece como una caja negra hasta que termina |
| worktrees aislados que puedes revisar, fusionar o descartar por separado | varios agentes modificando el mismo espacio de trabajo e interfiriendo entre sí |
| estadísticas de compilación que muestran qué entregaron los agentes, qué recursos usaron y cuánto costó | un contador de tokens sin registro de lo construido |

**En concreto, al instalarlo obtienes:** sesiones de chat para colaboración ligera y ejecución planificada, plantillas de flujo de trabajo en equipo listas para usar, issues controlados por el desarrollador que vinculan el trabajo con las sesiones, espacios de trabajo independientes para aislar tareas paralelas y estadísticas de compilación detalladas.

```text
sin openteams                       con openteams

Claude ─ terminal A ─┐              Claude ─┐
Codex ── terminal B ─┼─ tú conectas Codex ──┼─ sesión compartida
Gemini ─ terminal C ─┘              Gemini ─┘

plan: en otro sitio                  issues ── sesiones ── resultados
```

## Por qué openteams

Hacer que los agentes escriban código ya no es la parte difícil. Lo complicado es mantener el trabajo ordenado: conservar el contexto, saber por dónde va cada tarea, impedir que los trabajos paralelos se sobrescriban, decidir qué viene después y conocer el coste real.

openteams reúne a los agentes y sus conversaciones en una misma sesión. Para tareas grandes, el modo Workflow muestra los pasos y sus dependencias, de modo que puedes revisar o reintentar solo la parte necesaria. Si varias sesiones trabajan a la vez, cada una puede usar su propio Git worktree; los cambios permanecen separados hasta que decidas fusionarlos o descartarlos.

La dirección del proyecto sigue en manos del desarrollador. Los issues guardan el trabajo que has elegido y enlazan con las sesiones donde los agentes lo realizan. Los agentes hacen el trabajo, pero no cambian el plan por ti. Cuando terminan, las estadísticas de compilación muestran los resultados junto con los tokens utilizados y el coste.

openteams no intenta darte más agentes. Su objetivo es que siempre sepas qué se está construyendo, dónde están los cambios, qué viene después y cuánto costó el resultado.

## Inicio rápido
### Instalación
#### Aplicación de escritorio (recomendada)

Descarga la última versión para tu plataforma desde GitHub Releases.

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest/download/openteams-windows-x64.msi)
[![Download for macOS](https://img.shields.io/badge/Download-macOS-000000?style=for-the-badge&logo=apple)](https://github.com/openteams-lab/openteams/releases/latest/download/openteams-macos.dmg)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest/download/openteams-linux-amd64.deb)

**macOS:** La versión actual para macOS no está firmada con Apple Developer ID ni notarizada por Apple. Los navegadores añaden un atributo de cuarentena a las aplicaciones descargadas de Internet, por lo que Gatekeeper puede indicar que openteams está «dañada» aunque la descarga esté intacta. Después de mover `openteams.app` a `/Applications`, y solo si confías en que procede de la GitHub Release oficial de openteams, ejecuta:

```bash
xattr -dr com.apple.quarantine /Applications/openteams.app
```

Este comando solo elimina el atributo de cuarentena de openteams; no desactiva Gatekeeper globalmente.

#### npx

```bash
npx openteams-web
```

### Configurar proveedores

**openteams** incluye un agente openteams CLI integrado. Configura tus proveedores de modelos en la app desde `Settings → Provider Config → Add Provider`.

⚙️ [Configuración de proveedores](https://doc.openteams-lab.com/advanced-usage/custom-provider)

También puedes conectar agentes de código compatibles como:

| Agent | Ejemplo de instalación |
| --- | --- |
| Claude Code | `npm i -g @anthropic-ai/claude-code` |
| Gemini CLI | `npm i -g @google/gemini-cli` |
| Codex | `npm i -g @openai/codex` |
| Qwen Code | `npm i -g @qwen-code/qwen-code` |
| OpenCode | `npm i -g opencode-ai` |

📚 [Más guías de instalación de agentes](https://doc.openteams-lab.com/getting-started)

## Actualizaciones importantes
- **2026.05.20 (v0.4.4)**
  - Versión beta del modo Workflow
- **2026.05.07 (v0.3.22)**
  - Permite guardar con un clic los miembros de una sesión de chat grupal como equipo predefinido
- **2026.04.14 (v0.3.15)**
  - Visor de cambios de archivos del espacio de trabajo
- **2026.04.06 (v0.3.12)**
  - Activación del modo de UI oscura
  - Corrección de problemas de concurrencia en openteams-cli
- **2026.04.02 (v0.3.10)**
  - Implementación de actualización de versión dentro de la app
  - El sitio de documentación ya está disponible

## Hoja de ruta

openteams está en desarrollo activo. Hacia allí vamos:

- [ ] **Trabajadores IA expertos** — Lanzar más trabajadores de IA con conocimiento profundo de dominios específicos, capaces de resolver problemas especializados.
- [ ] **Equipos de IA de alto rendimiento** — Formar equipos con trabajadores de IA expertos y eficientes, capaces de personalizar workflows de producción para necesidades de negocio específicas y convertir requisitos en entregables de principio a fin.
- [ ] **Integrar más agentes** — Integrar más agentes de uso común, como Kilo Code, hermes-agent y openclaw, entre otros.

***Visión: transformar el consumo de tokens en productividad real.***

¿Tienes una solicitud de funcionalidad o quieres ayudar a definir la dirección? [Abre una discusión](https://github.com/openteams-lab/openteams/discussions).

## Comunidad

- [GitHub Issues](https://github.com/openteams-lab/openteams/issues): reportes de bugs y solicitudes de funcionalidades
- [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions): ideas de producto y preguntas
- [Discord](https://discord.gg/openteams): chat de la comunidad
- [Linux.do](https://linux.do): sitio asociado; gracias por apoyar el intercambio de la comunidad
- Grupos de la comunidad:

<p>
  <a href="images/openteams-wechat-community.png"><img alt="Código QR del grupo de la comunidad de openteams en WeChat" src="images/openteams-wechat-community.png" width="260"></a>
  <a href="images/openteams-feishu-community.png"><img alt="Código QR del grupo de la comunidad de openteams en Feishu/Lark" src="images/openteams-feishu-community.png" width="260"></a>
</p>

## Funcionalidades principales

| Funcionalidad | Qué significa |
| --- | --- |
| Empleados IA y equipos IA | Convierte tokens en productividad real. Cada empleado IA o equipo aporta experiencia de dominio que eleva modelos generalistas a especialistas listos para entregar trabajo, no solo generar texto. |
| Workspace multiagente | Reúne varios agentes de IA en una sesión compartida en lugar de alternar entre ventanas separadas. |
| Contexto compartido | Los agentes trabajan desde la misma conversación y el mismo contexto del proyecto. |
| Free Chat | Usa `@` para colaboración directa y ligera con agentes. |
| Modo Workflow | Convierte tareas complejas en pasos estructurados, dependencias, revisiones, reintentos y aceptación. |
| Ejecución visible | Mira qué está haciendo cada agente y dónde está bloqueado el trabajo. |
| Revisión y reintento | Revisa un paso, reintenta la tarea correcta y evita reiniciar todo el proyecto. |
| Gestión de issues | Registra y prioriza elementos de trabajo controlados por el desarrollador, sincroniza issues desde GitHub y crea o enlaza sesiones de ejecución. |
| Workspaces aislados | Ejecuta tareas de sesiones independientes en Git worktrees separados y revisa, fusiona o descarta cada resultado sin afectar al resto del trabajo. |
| Estadísticas de compilación | Compara bugs corregidos y funcionalidades entregadas con el consumo de tokens y los costes por sesión y modelo. |
| Artefactos y trazas | Mantén logs, diffs, transcripciones y artefactos generados unidos al trabajo. |
| Ejecución local | Los agentes trabajan sobre el espacio de trabajo configurado, con registros de ejecución guardados bajo `.openteams/`. |

## Para quién es

openteams es para:

- desarrolladores que usan varios agentes de código y están cansados de hacer malabares con ellos
- líderes técnicos que necesitan que las ejecuciones de agentes sean revisables y reproducibles

No es solo un lugar para reunir más agentes. Es una forma de convertir agentes en un equipo que trabaja.

## Stack tecnológico

| Capa | Tecnología |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Backend | Rust |
| Desktop | Tauri |
| Database | SQLx-managed relational schema |
| Workflow UI | React Flow |

## Desarrollo local

### Requisitos previos

- **Rust** >= 1.75
- **Node.js** >= 18
- **pnpm** >= 8

### macOS, Linux y Windows

```bash
# Clone the repository
git clone https://github.com/openteams-lab/openteams.git
cd openteams
pnpm i
npm run dev
# build
pnpm --filter frontend build
pnpm desktop:build
```

### Compilar `openteams-cli` localmente

Usa los siguientes comandos si necesitas compilar el binario local `openteams-cli` en lugar de usar la versión integrada o publicada.
Los artefactos de compilación se colocarán en el directorio binaries.

```bash
# From the repository root
bun run ./scripts/build-openteams-cli.ts
```

## Contribuir

Las contribuciones son bienvenidas, incluidos los workflows de equipos de IA reutilizables que otros puedan estudiar y adaptar. Así puedes empezar:

1. **Encuentra un issue** — Revisa [Good First Issues](https://github.com/openteams-lab/openteams/labels/good%20first%20issue) para tareas aptas para principiantes, o explora los issues abiertos.
2. **Habla antes de construir** — Antes de abrir una pull request grande, abre un issue o una discusión para acordar el enfoque.
3. **Sigue el estilo de código** — Ejecuta lo siguiente antes de enviar:

```bash
pnpm run format
pnpm run check
pnpm run lint
```

4. **Envía una PR** — Describe qué cambiaste y por qué. Enlaza el issue relacionado si aplica.

Consulta [CONTRIBUTING.md](../CONTRIBUTING.md) para la guía completa.

## Licencia

openteams se publica bajo Apache License 2.0. En términos prácticos, puedes:

- usarlo gratis en proyectos personales, educativos, internos o comerciales;
- copiar, modificar y reutilizar el código fuente como base de tu trabajo;
- distribuir la versión original o modificada, como código fuente o software compilado;
- incluirlo en un producto propietario y venderlo sin tener que publicar el resto de tu código.

Si redistribuyes openteams o una versión modificada, incluye una copia de la licencia, conserva los avisos de copyright y atribución pertinentes e indica claramente qué archivos modificaste.

También conviene conocer otros tres puntos:

- **Marca:** Puedes usar el código, pero no presentarte como el proyecto oficial openteams ni usar su nombre o sus marcas como tu propia marca.
- **Patentes:** Los contribuidores te permiten usar las patentes necesariamente relacionadas con su código, por lo que no pueden utilizarlas para impedir que uses openteams. A cambio, si presentas una demanda afirmando que openteams infringe tu patente, pierdes esa protección. Solo termina el permiso de patentes, no tu permiso normal para usar el código. Los usuarios que no participan en litigios de patentes normalmente no se ven afectados.
- **Riesgo:** El software se ofrece gratis tal como está. Tú decides si sirve para tus necesidades y asumes los riesgos de usarlo; el proyecto no ofrece garantía ni compensación.

Esta sección es un resumen en lenguaje sencillo. El archivo [LICENSE](../LICENSE) contiene los términos legales vinculantes.

Consulta [LICENSE](../LICENSE) para ver los términos legales completos.
