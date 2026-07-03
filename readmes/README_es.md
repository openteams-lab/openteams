<div align="center">
  <img src="../frontend/public/logos/logo_blue.svg" alt="OpenTeams" width="100">
</div>

<div align="center">
  <img src="../frontend/public/openteams-brand-logo.png" alt="OpenTeams" width="200" style="margin-top: 10px; margin-bottom: 10px;">

  <h5>Planifica, construye y entrega — con un equipo de agentes de IA en lugar de uno solo</h5>

  <p>
    Varios agentes de IA comparten un mismo contexto: colabora libremente por chat u orquesta tareas complejas con workflows que puedes ver, revisar y reintentar.
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
  <video src="https://github.com/user-attachments/assets/f918d5c7-68ff-4a8b-b2b4-f4f0ab31c17d" controls width="100%">
    <a href="https://github.com/user-attachments/assets/f918d5c7-68ff-4a8b-b2b4-f4f0ab31c17d">Ver el video del producto</a>
  </video>
</div>

## Qué es openteams

**openteams** es un workspace open source de colaboración multiagente. Reúne varios agentes de código de IA, como Claude Code, Codex, Gemini CLI y otros, en una sesión compartida donde pueden comunicarse, compartir contexto y trabajar juntos como un equipo. Puedes colaborar con los agentes mediante Free Chat ligero, u orquestar tareas complejas con Workflows estructurados, planes visibles, control por pasos y revisión integrada. Todo se ejecuta localmente en tu propio workspace.

## Por qué openteams

Los agentes de IA son cada vez mejores planificando, programando, revisando y probando. Pero más salida de agentes no se convierte automáticamente en trabajo entregado.

**Gestionar varios agentes agota.** Cambias entre terminales, vuelves a explicar el contexto a cada agente nuevo, copias la salida de un prompt al siguiente y reconcilias diffs contradictorios. Tu atención se va en el caos de coordinar múltiples agentes.

**La ejecución de los agentes es invisible y difícil de controlar.** Le dices a Claude Code: “construye esta funcionalidad”. Corre durante 15 minutos. No sabes qué subtareas intentó, cuáles pasaron ni cuáles abandonó en silencio. La mayoría de los agentes de código tratan hoy una tarea compleja como una única ejecución monolítica: no hay plan visible antes de ejecutar, no hay forma de aprobar o rechazar pasos individuales en mitad del proceso, no hay forma de reintentar solo el paso que falló. Cuando algo sale mal, empiezas de nuevo.

**openteams** resuelve ambos problemas. Los agentes **comparten un único contexto**, así que el trabajo no se pierde entre traspasos. Las tareas complejas se convierten en **workflows visibles y controlables**: puedes refinar el plan antes de ejecutarlo, ver cada paso mientras avanza e intervenir en cualquier nodo para aprobar, rechazar, reintentar o redirigir.

> La verdadera ventaja no es tener más agentes. Es orquestarlos con un plan complejo que puedes ver y pasos que puedes controlar.

## Casos de uso comunes

Escribes: “Añade sincronización de issues de GitHub al workspace.”


1. **El lead agent aclara los requisitos:** pregunta por la dirección de sincronización (¿unidireccional o bidireccional?), el manejo de conflictos (¿omitir, sobrescribir o registrar?) y qué campos de issue mapear. Confirmas: pull unidireccional, registrar conflictos, mapear title/body/labels/status.
2. **El lead agent diseña el enfoque y construye el plan de ejecución:** el plan muestra 5 pasos: `Backend: OAuth + GitHub API` → `Backend: Sync Engine` → `Frontend: Sync Status UI` → `Integration Tests` → `Final Review`. Cada paso tiene alcance claro, agente asignado y criterios de aceptación.
3. **Revisas y apruebas el plan:** puedes ajustar pasos, reordenar dependencias o reasignar agentes antes de que se ejecute código.
4. **Los agentes ejecutan y observas el progreso en tiempo real:** `Backend: OAuth` corre primero. Cuando termina, `Sync Engine` y `Frontend: Sync Status UI` empiezan en paralelo. Cada paso muestra su estado, diff y logs en el grafo de workflow.
5. **Revisas y apruebas cada paso completado:** `Backend: OAuth` termina. Inspeccionas el diff, ves la lógica de refresh de tokens y apruebas. Los siguientes pasos continúan.
6. **Un paso falla y reintentas solo ese paso:** `Integration Tests` falla porque el motor de sync devuelve timestamps crudos en vez de formato ISO. Revisas el log de error y reintentas solo el paso `Integration Tests`. El resto del workflow permanece intacto.
7. **Revisión final y aceptación:** todos los pasos pasan. Revisas el diff completo, los artefactos y los resultados de pruebas, y luego aceptas.
8. **Seguimiento con Free Chat:** dos días después, un usuario reporta que el badge de estado de sync parpadea durante el polling. Abres Free Chat: `@Frontend Agent the sync status badge flickers when polling — debounce the state update`. Se corrige en un turno, sin workflow.

## Inicio rápido
### Instalación
#### npx

```bash
npx openteams-web
```

#### Aplicación de escritorio

Descarga la última versión para tu plataforma desde GitHub Releases.

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest)

### Configurar proveedores

**openteams** incluye un agente openteams CLI integrado. Configura tus proveedores de modelos en la app desde `menu->setting->provider config->add provider`.

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

### Empieza en 30 segundos
**Requisitos previos: configura un proveedor de servicio API o instala cualquier Code Agent compatible.**

*paso 1.* Crea una sesión de chat grupal. Añade uno o más miembros y asigna a cada uno un modelo y un rol.

*paso 2.* En modo Free Chat, usa `@` para enviar un mensaje o asignar una tarea a cualquier miembro.

*paso 3.* Cambia a modo Workflow. Habla de los requisitos con el lead agent, refina la solución y genera un plan de ejecución.

*paso 4.* Inicia la ejecución y revisa el resultado de cada nodo de tarea cuando termine.

## Modos de trabajo

**openteams** admite dos modos de colaboración, porque no todas las tareas necesitan el mismo nivel de estructura. Piensa en ello como los modos **Plan y Build de Claude Code**, pero para equipos multiagente: elige colaboración libre cuando quieras que los agentes exploren y conversen abiertamente, y workflows estructurados cuando necesites una ejecución fiable y predecible.

### Free Chat

En el modo de chat libre, usas `@` para enviar una tarea a cualquier agente, y los agentes pueden pasarse mensajes entre sí. La colaboración se rige por un protocolo de equipo que tú defines: quién hace qué, cómo se entregan el trabajo y qué estándares seguir.

**free chat mode** es ideal para pequeños arreglos, revisiones rápidas y conversaciones exploratorias donde un workflow completo sería excesivo.

![](images/free_chat.png)

### Workflow

El modo Workflow está diseñado para tareas complejas que necesitan dividirse en subtareas, con progreso observable y ejecución controlable en cada paso.

Un lead agent dirige la fase de planificación: aclara requisitos, diseña el enfoque, define el plan de ejecución y asigna tareas a los agentes adecuados. El resultado es un workflow visible con pasos, dependencias, revisiones, reintentos y puntos de aceptación.

![](images/openteams-workflow.png)

En lugar de pedir a los agentes que se ejecuten en una cadena suelta, **openteams** convierte el trabajo en un grafo de ejecución con estado.

**Nota: el modo Workflow usa más tokens. Asegúrate de tener saldo suficiente.**

## Actualizaciones importantes
- **2026.05.20 (v0.4.4)**
  - Versión beta del modo Workflow
- **2026.05.07 (v0.3.22)**
  - Permite guardar con un clic los miembros de una sesión de chat grupal como equipo predefinido
- **2026.04.14 (v0.3.15)**
  - Visor de cambios de archivos del workspace
- **2026.04.06 (v0.3.12)**
  - Activación del modo de UI oscura
  - Corrección de problemas de concurrencia en openteams-cli
- **2026.04.02 (v0.3.10)**
  - Implementación de actualización de versión dentro de la app
  - El sitio de documentación ya está disponible

## Hoja de ruta

openteams está en desarrollo activo. Hacia allí vamos:

- [ ] **Trabajadores IA expertos** — Lanzar más trabajadores de IA con conocimiento profundo de dominios específicos, capaces de resolver problemas especializados.
- [ ] **Equipos IA de alta producción** — Formar equipos con trabajadores de IA expertos y eficientes, capaces de personalizar workflows de producción para necesidades de negocio específicas y convertir requisitos en resultados de extremo a extremo.
- [ ] **Integrar más agentes** — Integrar más agentes de uso común, como Kilo code, hermes-agent, openclaw, entre otros.

***Visión: transformar el consumo de tokens en productividad real.***

¿Tienes una solicitud de funcionalidad o quieres ayudar a definir la dirección? [Abre una discusión](https://github.com/openteams-lab/openteams/discussions).

## Comunidad

- [GitHub Issues](https://github.com/openteams-lab/openteams/issues): reportes de bugs y solicitudes de funcionalidades
- [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions): ideas de producto y preguntas
- [Discord](https://discord.gg/openteams): chat de la comunidad
- [Linux.do](https://linux.do): enlace amigo; gracias por apoyar el intercambio de la comunidad
- Grupos de la comunidad:

<p>
  <a href="images/openteams-wechat-community.png"><img alt="Código QR del grupo de la comunidad de OpenTeams en WeChat" src="images/openteams-wechat-community.png" width="260"></a>
  <a href="images/openteams-feishu-community.png"><img alt="Código QR del grupo de la comunidad de OpenTeams en Feishu/Lark" src="images/openteams-feishu-community.png" width="260"></a>
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
| Artefactos y trazas | Mantén logs, diffs, transcripciones y artefactos generados unidos al trabajo. |
| Ejecución local del workspace | Los agentes trabajan sobre el workspace configurado, con registros de ejecución guardados bajo `.openteams/`. |

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

### Mac/Linux

```bash
# Clone the repository
git clone https://github.com/openteams-lab/openteams.git
cd openteams
pnpm i
pnpm run dev
# build
pnpm --filter frontend build
pnpm desktop:build
```

### Windows (PowerShell): iniciar backend y frontend por separado

`pnpm run dev` no puede ejecutarse en Windows PowerShell. Usa los siguientes comandos para ejecutar backend y frontend por separado.

```powershell
git clone https://github.com/openteams-lab/openteams.git
cd openteams
pnpm i
pnpm run generate-types
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
$env:FRONTEND_PORT = <frontend port generated from terminal A>
$env:BACKEND_PORT = <backend port generated from terminal A>
cd frontend
pnpm dev -- --port $env:FRONTEND_PORT --host
```

Abre la página frontend en `http://localhost:<FRONTEND_PORT>` (por ejemplo: `http://localhost:3001`).

### Compilar `openteams-cli` localmente

Usa los siguientes comandos si necesitas compilar el binario local `openteams-cli` en lugar de usar la versión integrada o publicada.
Los artefactos de compilación se colocarán en el directorio binaries.

```bash
# From the repository root
bun run ./scripts/build-openteams-cli.ts
```

## Contribuir

Las contribuciones son bienvenidas. Así puedes empezar:

1. **Encuentra un issue** — Revisa [Good First Issues](https://github.com/openteams-lab/openteams/labels/good%20first%20issue) para tareas aptas para principiantes, o explora los issues abiertos.
2. **Habla antes de construir** — Antes de abrir una pull request grande, abre un issue o una discusión para alinear la dirección.
3. **Sigue el estilo de código** — Ejecuta lo siguiente antes de enviar:

```bash
pnpm run format
pnpm run check
pnpm run lint
```

4. **Envía una PR** — Describe qué cambiaste y por qué. Enlaza el issue relacionado si aplica.

Consulta [CONTRIBUTING.md](../CONTRIBUTING.md) para la guía completa.

## Licencia

Este proyecto usa Apache License 2.0. Consulta [LICENSE](../LICENSE) para ver
el texto completo, incluidos los avisos de copyright y las reglas de
redistribución.

Puedes usar, cambiar, publicar y vender este proyecto,
incluso dentro de productos cerrados. Conserva el aviso de copyright, conserva
el texto de la licencia y cuenta qué cambiaste si lo modificas. No elimines los
avisos obligatorios, no uses el nombre o las marcas del dueño del proyecto como
respaldo, y no esperes mantener la concesión de patentes si inicias una demanda
de patentes sobre este proyecto. El software se entrega tal cual, sin garantía.
