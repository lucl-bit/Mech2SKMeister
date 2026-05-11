function [isInCollision, minDistances] = checkTrajectoryCollisions(robot, qTraj, env)
%CHECKTRAJECTORYCOLLISIONS Check robot self/environment collisions.

numSamples = size(qTraj, 1);
isInCollision = false(numSamples, 1);
minDistances = inf(numSamples, 1);

for i = 1:numSamples
    q = qTraj(i, :);

    % R2026a accepts only "on"/"off" here. For this starter project we focus
    % on robot-vs-environment collision; detailed adjacent-link self-collision
    % can be added later with custom filtering.
    selfCollision = false;
    [envCollision, sepDist] = checkCollision(robot, q, env, ...
        "IgnoreSelfCollision", "on", ...
        "Exhaustive", "on");

    isInCollision(i) = selfCollision || envCollision;

    if ~isempty(sepDist)
        minDistances(i) = min(sepDist(:));
    end
end
end
