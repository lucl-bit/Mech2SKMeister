function [qTraj, qdTraj, qddTraj, time] = planJointTrajectory(qWaypoints, samplesPerSegment, dt)
%PLANJOINTTRAJECTORY Generate smooth joint trajectories between waypoints.

numSegments = size(qWaypoints, 1) - 1;
numJoints = size(qWaypoints, 2);
totalSamples = numSegments * (samplesPerSegment - 1) + 1;

qTraj = zeros(totalSamples, numJoints);
qdTraj = zeros(totalSamples, numJoints);
qddTraj = zeros(totalSamples, numJoints);

writeIndex = 1;
for segment = 1:numSegments
    qStart = qWaypoints(segment, :)';
    qEnd = qWaypoints(segment + 1, :)';
    segmentTimes = linspace(0, dt * (samplesPerSegment - 1), samplesPerSegment);

    [q, qd, qdd] = trapveltraj([qStart, qEnd], samplesPerSegment, ...
        "EndTime", segmentTimes(end));

    if segment > 1
        q = q(:, 2:end);
        qd = qd(:, 2:end);
        qdd = qdd(:, 2:end);
    end

    n = size(q, 2);
    qTraj(writeIndex:writeIndex + n - 1, :) = q';
    qdTraj(writeIndex:writeIndex + n - 1, :) = qd';
    qddTraj(writeIndex:writeIndex + n - 1, :) = qdd';
    writeIndex = writeIndex + n;
end

time = (0:totalSamples - 1)' * dt;
end
