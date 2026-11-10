// Aplicación web: sirve la página e incluye sus partes (estilos, código e imágenes).

function doGet() {
  const plantilla = HtmlService.createTemplateFromFile('Index');
  return plantilla.evaluate()
    .setTitle('CRM Redex · BDB Logística')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}
