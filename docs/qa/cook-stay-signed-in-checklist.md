# QA · El cocinero se queda con la sesión

Necesita la migración 078 aplicada en Staging (el SQL está en el PR). Datos de demo solamente. Roles: dueño, administrador y encargado para las herramientas del equipo; el cocinero no ve precios, costos, merma ni ventas en ninguna pantalla nueva.

## A · Quedarse con la sesión (teléfono del cocinero)
1. Únete con un enlace nuevo, tu nombre y **un PIN de 4 a 6 números** (con confirmación). 1234, 0000 y 1111 se rechazan con un mensaje claro. Al terminar ves **Tu código de cocina**.
2. Cierra la app del todo y ábrela otra vez: sigues dentro. Repite al día siguiente: sigues dentro (el token no vence).
3. Modo avión, abre la app y envía un aviso: queda en la cola y no te saca. Apaga el modo avión: se envía.
4. Con mala señal (la app tarda o falla): no te saca de la sesión.
5. En la web, **Configuración › Equipo › Equipo de cocina en la app**: «Cerrar sesión en este teléfono». En el teléfono, la siguiente acción te lleva a entrar de nuevo (solo después de un reintento) y **los avisos que estaban en la cola siguen ahí** cuando vuelves a entrar como la misma persona.
6. «Cerrar sesión» en Perfil borra todo, incluida la cola.

## B · Entrar con PIN (sin el enlace original)
7. En la pantalla de entrada toca **Ya tengo cuenta / Entrar con PIN**. Escribe el código de cocina, tu nombre (sin importar mayúsculas ni acentos) y tu PIN: entras con un token nuevo y tu historial sigue ahí.
8. Un dato mal (código, nombre o PIN) da **siempre el mismo mensaje**, sin decir cuál falló. El mensaje dice «Pide a tu encargado un PIN o un nuevo enlace».
9. **5 intentos fallidos** bloquean a ese nombre 15 minutos (también con el PIN correcto). El mensaje dice cuánto falta. Un nombre que no existe se bloquea igual.
10. Un cocinero que se unió antes de que existieran los PIN no puede entrar con PIN: ve el mensaje del punto 8; al abrir la app con su sesión vieja, la app le pide **crear su PIN**.

## C · Face ID / huella (opcional)
11. Después de crear el PIN, la app ofrece **Usar Face ID / huella**. Acepta: en «Entrar con PIN» aparece «Entrar con Face ID / huella». Cancela la huella: puedes escribir el PIN. En un teléfono sin biometría la oferta no aparece.
12. En Perfil, activa el bloqueo de la app: al abrirla (o volver tras más de un minuto) pide Face ID / huella; si falla, pide el PIN. Desactívalo: el PIN guardado en el teléfono se borra. Nada biométrico sale del teléfono.

## D · Herramientas del encargado (web: Configuración › Equipo, y móvil: Perfil)
13. Entra como **encargado**: ves «Equipo de cocina en la app» con el código de cocina y cada cocinero (con PIN / sin PIN, teléfonos). Como visor o miembro no se ve.
14. **Restablecer PIN · PIN temporal**: confirma, aparece un PIN de 6 números **una sola vez**. El cocinero entra con él y la app le obliga a crear uno nuevo. **Quitar PIN**: el teléfono ya abierto sigue abierto y puede crear un PIN nuevo.
15. **Enviar nuevo enlace**: sale un enlace de un solo uso (7 días). Ábrelo en un teléfono nuevo: entra **el mismo cocinero** (no se crea otro; el historial se queda).
16. **Cerrar sesión en este teléfono** (uno) y **en todos**: el teléfono afectado vuelve a pedir entrada.
17. Un dueño de otra empresa no ve ni toca a tus cocineros.

## E · Del modo Gestión a Cocina sin enlace (móvil)
18. Entra como encargado, Perfil › **Cocina**: se abre Cocina sin pedir enlace (se crea tu propio perfil de cocina, una sola vez por restaurante). Cambiar entre Gestión y Cocina no cierra ninguna de las dos sesiones.
19. Un visor no puede abrir Cocina de esta forma.

## F · General
20. Con 390 px todo se lee sin desplazamiento horizontal. es / en / de: todos los textos nuevos existen en los tres idiomas. No hay cajas amarillas.
