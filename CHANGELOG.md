# Changelog

## 2.2.33

- A device now shares its fresh anonymous guest session every 3 hours instead of every 10, so the published seed pool holds
  more live sessions. Nothing about the person travels with it, and the plugin's own "contribute seeds" setting still turns it off.
  / Un aparato ahora comparte su sesión anónima nueva cada 3 horas en vez de cada 10, para que el grupo de semillas publicado
  tenga más sesiones vivas. No viaja nada de la persona, y el ajuste "contribuir semillas" del plugin sigue apagándolo.

## 2.2.32

- A movie's page can now ask TMDB which film it is, so it shows its logo, synopsis and cast. Cards and search results of the
  portal name no id, and a movie has no episodes call, so Kino had nothing to ask TMDB by. The plugin now answers a movie's
  ids (`details`, apiVersion 8): the IMDb id the portal's own detail names, else the TMDB film the portal's title CLEARLY
  means (the same strict rule series already use: exactly one exact title, or the only one holding every word, or one at
  least twice as popular as the next). With neither it answers nothing, never a guess.
  / La ficha de una película ya puede preguntarle a TMDB cuál es, para mostrar su logo, sinopsis y reparto. Las tarjetas y
  los resultados de búsqueda del portal no traen ningún id y una película no tiene la llamada de episodios, así que Kino no
  tenía con qué preguntar. El plugin ahora responde los ids de una película (`details`, apiVersion 8): el IMDb que nombra el
  propio detalle del portal o, si no, la película de TMDB que el título del portal significa CLARAMENTE (la misma regla
  estricta que ya usan las series). Sin ninguno de los dos no responde nada, nunca adivina.
- A portal season that TMDB splits into several (Dragon Ball Kai: T1 with 98 chapters at the portal, seasons of about 26 at
  TMDB) now gets its stills: when consecutive TMDB seasons add up EXACTLY to the portal season's chapters, in one way only,
  the chapters are matched in order. Any other case attaches nothing, as before.
  / Una temporada del portal que TMDB parte en varias (Dragon Ball Kai: T1 con 98 capítulos en el portal, temporadas de unos
  26 en TMDB) ahora recibe sus imágenes: cuando varias temporadas seguidas de TMDB suman EXACTAMENTE los capítulos de la del
  portal, y de una sola manera, los capítulos se emparejan en orden. Cualquier otro caso no pone nada, como antes.

## 2.2.31

- The shared seed pool is no longer cut to its first 200. The published file now holds many more live seeds, and each
  device keeps 200 of them AT RANDOM (those about to expire are drawn last), so thousands of people spread over the whole
  pool instead of all trying the same few. A file of 200 or fewer behaves as before.
  / El grupo de semillas compartidas ya no se corta en las primeras 200. El archivo publicado trae muchas más semillas
  vivas y cada aparato se queda con 200 AL AZAR (las que están por vencer se eligen al final), así miles de personas se
  reparten todo el grupo en vez de probar todas las mismas pocas. Un archivo de 200 o menos funciona como antes.

## 2.2.29

- Works with the Kino that saves what is typed before a button runs (0.9.63 on): the texts no longer ask the person to
  tap Guardar first there. Older Kino keeps saying so, and "Te enviamos un código a …" now adds that a different email
  needs Guardar, since those versions run the button on the saved one.
  / Compatible con el Kino que guarda lo escrito antes de ejecutar un botón (0.9.63 en adelante): ahí los textos ya no
  piden pulsar Guardar. En versiones anteriores se sigue diciendo, y el aviso de código enviado agrega que otro correo
  necesita Guardar.
- A registration under way (a code typed or sent to that email) no longer asks the portal to sign in with the new
  account while saving: it was refused by design and only made the button wait.
  / Mientras hay un registro en curso, al guardar ya no se intenta iniciar sesión con la cuenta nueva (siempre se
  rechazaba y solo hacía esperar al botón).

## 2.2.28

- Fix: while "Crear cuenta" is being filled, what sits in "Cuenta" (an old or wrong pair) is no longer checked and can
  no longer refuse the save. A red "Credenciales inválidas" high in the form kept the whole form from saving, so the
  email typed below never reached the plugin and "Enviar código" kept saying the email was missing.
  / Arreglo: mientras se llena "Crear cuenta", lo que haya en "Cuenta" ya no se revisa ni impide guardar. Un error
  en rojo arriba bloqueaba todo el guardado y el correo de abajo nunca llegaba al plugin.
- The "enter your email" message now also says to tap Guardar first, since the buttons read what is saved.
  / El aviso de correo vacío ahora también dice que pulses Guardar antes de tocar el botón.

## 2.2.27

- Settings: "Crear cuenta" is its own block again, now with its own email and password: email, "Enviar código", the
  code, the password and "Crear cuenta", in that order, without hunting for fields in the block above. The account
  created there is the one the session keeps (it is read from where it was typed; the "Cuenta" fields still win when
  both are filled), and "Cerrar sesión" clears both blocks. 2.2.26 had folded the steps into the "Cuenta" block.
  / Ajustes: "Crear cuenta" vuelve a ser un bloque aparte, ahora con su propio correo y contraseña: correo, Enviar
  código, código, contraseña y Crear cuenta, en ese orden. La cuenta que se crea ahí es la que usa la sesión, y
  "Cerrar sesión" limpia los dos bloques.

## 2.2.26

- Settings: creating an account now reads as one flow in the Account tab: email, "Enviar código", the code, the
  password and "Crear cuenta", in that order (the email and password are the same fields used to sign in, so nothing
  about how accounts are stored changes). Before, the code field sat alone under "Crear cuenta" and the email and
  password were in a different block above, so the steps were easy to miss.
  / Ajustes: crear una cuenta ahora se lee como un solo flujo en la pestaña Cuenta: correo, Enviar código, código,
  contraseña y Crear cuenta, en ese orden. Antes el código quedaba solo en "Crear cuenta" y el correo y la contraseña
  estaban en otro bloque más arriba.

## 2.2.25

- Fix: the anonymous session shared after Home no longer makes Home time out. Kino hands Home's rows over only once
  everything the plugin started has finished, so the three portal requests of the contribution (up to 25 s) were paid
  by Home. They now end within 15 s of Home's start and take at most 8 s; with less time left they wait for a later Home.
  / Arreglo: la sesión anónima que se comparte después del Inicio ya no hace que el Inicio se pase del tiempo; ahora
  tiene un límite dentro del tiempo del propio Inicio.
- Fix: a TV where refreshing one saved part of the catalog made the call slow (decoding, sorting and saving take seconds
  on weak TVs) refreshes at most once every 30 minutes and shows what it already has meanwhile, so Home, Categorías and
  the section no longer time out one after another until Kino switches the plugin off ("No responde"). Fast devices are
  unchanged.
  / Arreglo: en televisores lentos el catálogo guardado se actualiza como mucho cada 30 minutos y mientras tanto se
  muestra lo que ya hay, así Kino ya no apaga el plugin por "No responde".
- Fix: a backup session the portal says is no longer logged in is not picked again for 6 hours, and a pool downloaded
  minutes ago is not downloaded again while it still has a working session. Blocked regions reach the content with
  fewer round trips, and no longer end on "Configura … en Ajustes" when only the reused session was dead.
  / Arreglo: una sesión de respaldo caída no se vuelve a elegir durante 6 horas, y no se descarga otra vez la lista si
  la de hace unos minutos todavía tiene sesiones que funcionan.
- Fix: the portal address that answered last is tried first on the next start, so an address that is down for you is
  not waited for every time.
  / Arreglo: la dirección del portal que respondió la última vez se prueba primero en el siguiente arranque.
- Fewer diagnostic reports: a quick catalog save or decode is kept in the plugin's own log instead of being sent, and a
  call of 20 s or more is reported once instead of twice. Less work and data on weak devices.
  / Menos reportes de diagnóstico: los guardados y decodificaciones rápidas ya no se envían, y una llamada lenta se
  reporta una sola vez.
