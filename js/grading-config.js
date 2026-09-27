export const GRADING_CONFIG={
  weights:{centering:.30,corners:.25,edges:.25,surface:.20},
  minPhotoConfidence:.45,
  confidenceCaps:{frontOnly:68,frontBack:88,poorPhoto:42,weakGeometry:48},
  severeDefectCaps:{crease:5.5,majorCorner:6.5,majorEdge:6.5,majorSurface:6},
  manualDefects:{
    crease:{label:"Piega / crease visibile",cap:5.5,severity:"high"},
    dent:{label:"Ammaccatura o pressione profonda",cap:7,severity:"high"},
    tear:{label:"Strappo o parte mancante",cap:2,severity:"high"},
    water:{label:"Danno da acqua / deformazione",cap:4,severity:"high"},
    alteration:{label:"Scritta, inchiostro o alterazione",cap:4,severity:"high"},
    severeWhitening:{label:"Whitening molto evidente",cap:6.5,severity:"medium"}
  },
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
    creaseProminence:3.15,
    weakCenteringSignal:.24
  },
  photo:{
    targetBrightness:132,
    acceptableBrightness:[58,205],
    maxGlare:.055,
    minSharpness:75,
    hardLimits:{minBrightness:30,maxBrightness:232,minSharpness:35,maxGlare:.12,minWidth:400,minHeight:560}
  },
  professionalDisclaimer:"Questa è una stima fotografica non ufficiale. Fotografie, luce, sleeve, riflessi e texture olografiche possono alterare il risultato; non sostituisce una valutazione fisica effettuata da un grading service."
};
