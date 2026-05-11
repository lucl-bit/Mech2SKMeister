function env = createEnvironment()
%CREATEENVIRONMENT Create table, obstacle, pick object, and place bin.

tableTop = collisionBox(1.20, 0.90, 0.05);
tableTop.Pose = trvec2tform([0.35, 0.00, -0.025]);

obstacle = collisionBox(0.16, 0.16, 0.36);
obstacle.Pose = trvec2tform([0.35, 0.02, 0.18]);

pickObject = collisionCylinder(0.045, 0.11);
pickObject.Pose = trvec2tform([0.45, -0.28, 0.055]);

placeBin = collisionBox(0.18, 0.18, 0.08);
placeBin.Pose = trvec2tform([0.30, 0.33, 0.04]);

env = {tableTop, obstacle, pickObject, placeBin};
end
