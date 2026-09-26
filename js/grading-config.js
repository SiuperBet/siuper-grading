export const GRADING_CONFIG={
  weights:{centering:.30,corners:.25,edges:.25,surface:.20},
  minPhotoConfidence:.45,
  confidenceCaps:{frontOnly:68,frontBack:88,poorPhoto:42,weakGeometry:48},
  severeDefectCaps:{crease:5.5,majorCorner:6.5,majorEdge:6.5,majorSurface:6},
  thresholds:{
    majorCornerScore:4.4,
    majorEdgeScore:4.2,
    majorSurfaceScore:4.8,
    highGlareRatio:.035,
    lowSharpnessVariance:105,
    lowExposure:48,
    highExposure:218,
    whiteningHigh:.085,
    scratchHigh:.035,
    creaseProminence:3.15
  },
  photo:{
    targetBrightness:132,
    acceptableBrightness:[58,205],
    maxGlare:.055,
    minSharpness:75
  },
  professionalDisclaimer:"Questa è una stima fotografica non ufficiale. Fotografie, luce, sleeve, riflessi e texture olografiche possono alterare il risultato; non sostituisce una valutazione fisica effettuata da un grading service."
};
